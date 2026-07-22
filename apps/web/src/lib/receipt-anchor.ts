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
 * Reads the ReceiptAnchor contract on Stellar.
 *
 * Every call here is a read-only simulation — nothing is signed, nothing is
 * submitted, and no fees are paid. That matters for the public verifier: an
 * agent operator must be able to check a receipt without an account, a wallet,
 * or any trust in this service.
 */

export const RECEIPT_ANCHOR_ID =
  process.env.NEXT_PUBLIC_RECEIPT_ANCHOR_ID ??
  'CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV';

const RPC_URL = process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

/**
 * Simulation needs a source account, but never uses its balance or sequence.
 * A well-known address with a zero sequence keeps the verifier usable by
 * callers who have no Stellar account at all.
 */
const SIMULATION_SOURCE =
  process.env.MERCHANT_ADDRESS ??
  'GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6';

export interface BatchRecord {
  root: string;
  count: number;
  periodStart: number;
  periodEnd: number;
}

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
 * Returns the contract's own answer — the point of the verifier is that this
 * number comes from the ledger, not from us.
 */
export async function verifyReceiptOnChain(
  batchId: number,
  leaf: string,
  proof: string[],
): Promise<boolean> {
  const result = await simulate('verify_receipt', [
    nativeToScVal(batchId, { type: 'u64' }),
    hexToScValBytes(leaf),
    xdr.ScVal.scvVec(proof.map(hexToScValBytes)),
  ]);
  return result === true;
}

/** Reads an anchored batch. Throws if the batch does not exist. */
export async function getBatch(batchId: number): Promise<BatchRecord> {
  const raw = (await simulate('get_batch', [
    nativeToScVal(batchId, { type: 'u64' }),
  ])) as Record<string, unknown>;

  const root = raw.root;
  return {
    root: Buffer.isBuffer(root)
      ? root.toString('hex')
      : Buffer.from(root as Uint8Array).toString('hex'),
    count: Number(raw.count),
    periodStart: Number(raw.period_start),
    periodEnd: Number(raw.period_end),
  };
}

export { Address };
