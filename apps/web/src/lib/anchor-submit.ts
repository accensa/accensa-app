import {
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { readStatus, signTransaction } from './freighter';
import { RECEIPT_ANCHOR_ID } from './receipt-anchor';

/**
 * Builds, signs, and submits `anchor_batch` from the browser.
 *
 * Same shape as `submitRefund`: the merchant's key never leaves Freighter,
 * this module assembles the envelope and submits whatever comes back. A
 * rejection, a wrong-network wallet, and a transaction that fails after
 * signing each become a `failed` outcome with a message fit to render.
 */

const RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

const CONFIRM_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

export interface AnchorInput {
  root: string;
  count: number;
  periodStart: number;
  periodEnd: number;
  merchant: string;
}

export type AnchorOutcome =
  | { status: 'confirmed'; hash: string; batchId: number }
  | { status: 'pending'; hash: string }
  | { status: 'failed'; message: string; hash?: string };

const EXPECTED_NETWORK = NETWORK_PASSPHRASE === Networks.PUBLIC ? 'PUBLIC' : 'TESTNET';

export async function submitAnchor(input: AnchorInput): Promise<AnchorOutcome> {
  const wallet = await readStatus();
  if (wallet.kind === 'unavailable') {
    return { status: 'failed', message: 'Freighter is not installed in this browser.' };
  }
  if (wallet.kind === 'disconnected') {
    return {
      status: 'failed',
      message: 'Connect Freighter and approve this site before anchoring.',
    };
  }
  if (wallet.kind === 'error') {
    return { status: 'failed', message: wallet.message };
  }
  if (wallet.address !== input.merchant) {
    return {
      status: 'failed',
      message: `Connected wallet ${wallet.address} is not the merchant account that owns ReceiptAnchor.`,
    };
  }
  if (wallet.network && wallet.network !== EXPECTED_NETWORK) {
    return {
      status: 'failed',
      message: `Wallet is on ${wallet.network}. Switch Freighter to ${EXPECTED_NETWORK} and try again.`,
    };
  }

  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith('http://') });

  try {
    const account = await server.getAccount(input.merchant);

    const operation = new Contract(RECEIPT_ANCHOR_ID).call(
      'anchor_batch',
      xdr.ScVal.scvBytes(Buffer.from(input.root, 'hex')),
      nativeToScVal(input.count, { type: 'u32' }),
      nativeToScVal(input.periodStart, { type: 'u64' }),
      nativeToScVal(input.periodEnd, { type: 'u64' }),
    );

    const built = new TransactionBuilder(account, {
      fee: '1000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(180)
      .build();

    const prepared = await server.prepareTransaction(built);

    let signedXdr: string;
    try {
      signedXdr = await signTransaction(prepared.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: input.merchant,
      });
    } catch (error) {
      return { status: 'failed', message: describeRejection(error) };
    }

    const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    const sent = await server.sendTransaction(signed);

    if (sent.status === 'ERROR') {
      return {
        status: 'failed',
        message: 'The network rejected the transaction after it was signed.',
        hash: sent.hash,
      };
    }

    return await waitForConfirmation(server, sent.hash);
  } catch (error) {
    return { status: 'failed', message: describe(error) };
  }
}

async function waitForConfirmation(server: rpc.Server, hash: string): Promise<AnchorOutcome> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);

    if (result.status === 'SUCCESS') {
      const batchId = Number(scValToNative(result.returnValue));
      if (!Number.isSafeInteger(batchId) || batchId < 1) {
        return {
          status: 'failed',
          message: 'The transaction succeeded but did not return a batch id.',
          hash,
        };
      }
      return { status: 'confirmed', hash, batchId };
    }
    if (result.status === 'FAILED') {
      return { status: 'failed', message: 'The anchor transaction failed on-chain.', hash };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { status: 'pending', hash };
}

function describeRejection(error: unknown): string {
  const text = describe(error);
  if (/user.?reject|denied|refus|cancel/i.test(text)) {
    return 'Freighter rejected the signature. Nothing was submitted.';
  }
  return text;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The batch could not be submitted.';
}

export { Address };
