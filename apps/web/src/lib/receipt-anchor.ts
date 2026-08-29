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
import {
  createReceiptAnchorAbi,
  DEFAULT_RECEIPT_ANCHOR_ABI_VERSION,
  type BatchRecord,
  type ReceiptAnchorAbi,
} from '@accensa/sdk/receipt-anchor';

/**
 * Reads the ReceiptAnchor contract on Stellar.
 *
 * Every call here is a read-only simulation - nothing is signed, nothing is
 * submitted, and no fees are paid. That matters for the public verifier: an
 * agent operator must be able to check a receipt without an account, a wallet,
 * or any trust in this service.
 *
 * Method names and result shapes are not hard-coded here - they come from
 * `@accensa/sdk`'s ABI registry (see `packages/sdk/receipt-anchor.ts`, issue
 * #172), keyed by `RECEIPT_ANCHOR_ABI_VERSION`. Soroban contracts are
 * immutable once deployed, so if `RECEIPT_ANCHOR_ID` ever points at a
 * differently-versioned build, this is the one line that needs to change.
 */

export const RECEIPT_ANCHOR_ID =
  process.env.NEXT_PUBLIC_RECEIPT_ANCHOR_ID ??
  'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Simulation needs a source account, but never uses its balance or sequence.
 * A well-known address with a zero sequence keeps the verifier usable by
 * callers who have no Stellar account at all.
 */
const SIMULATION_SOURCE =
  process.env.MERCHANT_ADDRESS ?? 'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

/**
 * Which ABI `RECEIPT_ANCHOR_ID` speaks. Defaults to the only version this
 * contract has ever shipped as of #172; see `packages/sdk/receipt-anchor.ts`
 * for how to register support for a differently-versioned deployment.
 */
const RECEIPT_ANCHOR_ABI_VERSION =
  process.env.RECEIPT_ANCHOR_ABI_VERSION ?? DEFAULT_RECEIPT_ANCHOR_ABI_VERSION;

function abi(): ReceiptAnchorAbi {
  return createReceiptAnchorAbi(RECEIPT_ANCHOR_ABI_VERSION);
}

export type { BatchRecord };

/** A hex string of exactly 32 bytes. */
export function isHash32(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value.trim());
}

function hexToScValBytes(hex: string) {
  return xdr.ScVal.scvBytes(Buffer.from(hex.trim(), 'hex'));
}

async function simulate(method: string, args: xdr.ScVal[]): Promise<unknown> {
  const server = new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith('http://'),
  });
  const contract = new Contract(RECEIPT_ANCHOR_ID);
  const source = new Account(SIMULATION_SOURCE, '0');

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  if (!('result' in sim) || !sim.result?.retval) {
    throw new Error(`${method} returned no value`);
  }
  return scValToNative(sim.result.retval);
}

/**
 * Verifies a receipt against an anchored batch, on-chain.
 *
 * Returns the contract's own answer - the point of the verifier is that this
 * number comes from the ledger, not from us.
 */
export async function verifyReceiptOnChain(
  batchId: number,
  leaf: string,
  proof: string[],
): Promise<boolean> {
  const a = abi();
  const result = await simulate(a.verifyReceiptMethod, [
    nativeToScVal(batchId, { type: 'u64' }),
    hexToScValBytes(leaf),
    xdr.ScVal.scvVec(proof.map(hexToScValBytes)),
  ]);
  return a.decodeVerifyResult(result);
}

/** Reads an anchored batch. Throws if the batch does not exist. */
export async function getBatch(batchId: number): Promise<BatchRecord> {
  const a = abi();
  const raw = (await simulate(a.getBatchMethod, [
    nativeToScVal(batchId, { type: 'u64' }),
  ])) as Record<string, unknown>;
  return a.decodeBatch(raw);
}

/** Reads the max batch size configured on the contract. */
export async function getMaxBatchSize(): Promise<number> {
  const result = await simulate('max_batch_size', []);
  return Number(result);
}

export { Address };
