import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Reads the RefundVault contract, and dry-runs refunds before they are signed.
 *
 * The contract exposes no getter for its refund window or its paused flag —
 * both live in instance storage with no public accessor — so there is no way to
 * render "you have N ledgers left" from chain state alone. Simulating the
 * actual `refund` call is strictly better anyway: it runs the contract's own
 * guards in order and returns the exact error the real submission would hit,
 * rather than a guess reassembled from separate reads that could disagree with
 * it. Nothing is signed and no fee is paid to find out.
 */

export const REFUND_VAULT_ID =
  process.env.NEXT_PUBLIC_REFUND_VAULT_ID ??
  'CCMBM44EJUGD52G4LSMGHSXMAH2KSAQZX7VOYY4TTBF5BK4D7M4IHRQA';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Error discriminants from `contracts/refund-vault/src/lib.rs`.
 *
 * Kept in sync by hand; the contract is a separate repo with no generated
 * bindings here. A code this file does not know is reported as unknown rather
 * than mapped to the wrong message.
 */
export const REFUND_ERRORS = {
  1: 'AlreadyInitialized',
  2: 'NotInitialized',
  3: 'Unauthorized',
  4: 'AlreadyRefunded',
  5: 'WindowExpired',
  6: 'InsufficientFloat',
  7: 'InvalidAmount',
  8: 'Paused',
  9: 'RefundNotFound',
} as const;

export type RefundErrorName = (typeof REFUND_ERRORS)[keyof typeof REFUND_ERRORS];

/**
 * Merchant-facing wording.
 *
 * Each says what happened and what the merchant can do, because every one of
 * these is reachable through the UI and "Error(Contract, #6)" is not something
 * to put in front of someone trying to refund a customer.
 */
const MESSAGES: Record<RefundErrorName, string> = {
  AlreadyInitialized: 'This vault is already initialised.',
  NotInitialized: 'The refund vault has not been initialised yet.',
  Unauthorized: 'Only the merchant account that owns this vault can issue refunds.',
  AlreadyRefunded: 'This payment has already been refunded. A payment can only be refunded once.',
  WindowExpired:
    'The refund window for this payment has closed. The window is set on the vault and counted in ledgers from the payment.',
  InsufficientFloat:
    'The vault does not hold enough float to cover this refund. Deposit more before retrying.',
  InvalidAmount: 'The refund amount must be greater than zero.',
  Paused: 'Refunds are paused on this vault. Unpause it before issuing refunds.',
  RefundNotFound: 'No refund record exists for this payment.',
};

/** Turns a contract error code into something worth showing a merchant. */
export function describeRefundError(code: number): string {
  const name = REFUND_ERRORS[code as keyof typeof REFUND_ERRORS];
  return name ? MESSAGES[name] : `The contract rejected this refund with error code ${code}.`;
}

/**
 * Pulls the contract error discriminant out of a simulation failure.
 *
 * Soroban reports these as `Error(Contract, #6)`. Returns null for anything
 * else — an RPC outage or a malformed transaction is not a contract error, and
 * reporting it as one would tell the merchant something false about their
 * payment.
 */
export function parseContractErrorCode(message: string): number | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (match) return Number(match[1]);
  // Some RPC versions surface the raw enum instead.
  const alt = /ContractError\((\d+)\)/.exec(message);
  return alt ? Number(alt[1]) : null;
}

/**
 * A payment's reference in the vault.
 *
 * The transaction hash is used directly: it is exactly 32 bytes, globally
 * unique, and already the thing both the merchant and the payer can point at.
 * Deriving something else would mean the merchant could not check on an
 * explorer what a refund record refers to.
 */
export function paymentRef(txHash: string): string {
  const trimmed = txHash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(trimmed)) {
    throw new Error('Payment reference must be a 32-byte transaction hash in hex');
  }
  return trimmed;
}

export interface RefundRecord {
  amount: string;
  recipient: string;
  ledger: number;
}

export type RefundPreflight =
  /** The contract would accept this refund. */
  | { status: 'ok' }
  /** The contract would reject it, for a reason worth showing. */
  | { status: 'rejected'; code: number; name: RefundErrorName | null; message: string }
  /** We could not find out — RPC trouble, not a verdict on the refund. */
  | { status: 'unknown'; message: string };

function hexToBytes32(hex: string) {
  return xdr.ScVal.scvBytes(Buffer.from(paymentRef(hex), 'hex'));
}

function server() {
  return new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });
}

function build(
  source: string,
  method: string,
  args: xdr.ScVal[],
  vaultId: string = REFUND_VAULT_ID,
) {
  return new TransactionBuilder(new Account(source, '0'), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(vaultId).call(method, ...args))
    .setTimeout(30)
    .build();
}

/** Reads an existing refund record, or null when the payment was never refunded. */
export async function getRefund(
  txHash: string,
  source: string,
  vaultId: string = REFUND_VAULT_ID,
): Promise<RefundRecord | null> {
  const sim = await server().simulateTransaction(
    build(source, 'get_refund', [hexToBytes32(txHash)], vaultId),
  );

  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!('result' in sim) || !sim.result?.retval) return null;

  const raw = scValToNative(sim.result.retval) as Record<string, unknown> | null;
  if (!raw) return null;

  return {
    amount: String(raw.amount ?? '0'),
    recipient: String(raw.recipient ?? ''),
    ledger: Number(raw.ledger ?? 0),
  };
}

/**
 * Dry-runs a refund against the live contract.
 *
 * `merchant` is the address that would sign. It matters: the contract's
 * `require_auth` runs during simulation, so passing the wrong account reports
 * Unauthorized here rather than after the merchant has signed.
 */
export async function preflightRefund(input: {
  txHash: string;
  recipient: string;
  /** Stroops, as a decimal string. Never a float. */
  amount: string;
  paidAtLedger: number;
  merchant: string;
  vaultId?: string;
}): Promise<RefundPreflight> {
  let tx;
  try {
    tx = build(
      input.merchant,
      'refund',
      [
        hexToBytes32(input.txHash),
        new Address(input.recipient).toScVal(),
        nativeToScVal(BigInt(input.amount), { type: 'i128' }),
        nativeToScVal(input.paidAtLedger, { type: 'u32' }),
      ],
      input.vaultId ?? REFUND_VAULT_ID,
    );
  } catch (error) {
    return { status: 'unknown', message: error instanceof Error ? error.message : 'Invalid input' };
  }

  let sim;
  try {
    sim = await server().simulateTransaction(tx);
  } catch (error) {
    return {
      status: 'unknown',
      message: error instanceof Error ? error.message : 'Could not reach the network',
    };
  }

  if (rpc.Api.isSimulationError(sim)) {
    const code = parseContractErrorCode(sim.error);
    if (code === null) return { status: 'unknown', message: sim.error };
    return {
      status: 'rejected',
      code,
      name: REFUND_ERRORS[code as keyof typeof REFUND_ERRORS] ?? null,
      message: describeRefundError(code),
    };
  }

  return { status: 'ok' };
}
