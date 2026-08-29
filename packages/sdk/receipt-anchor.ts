/**
 * ABI version registry for the ReceiptAnchor Soroban contract (issue #172).
 *
 * Soroban contracts are immutable once deployed: if `ReceiptAnchor`'s
 * interface ever changes, the change ships as a *new* contract address, and
 * every address deployed before it keeps speaking whatever ABI it was built
 * with, forever. A single hard-coded set of method names and field names -
 * which is what `apps/web/src/lib/receipt-anchor.ts` had before this change -
 * therefore breaks the moment this SDK talks to any deployment that isn't
 * running the exact version it was written against.
 *
 * This module has no dependency on `@stellar/stellar-sdk` and does no
 * network I/O. It only knows two things per ABI version: which contract
 * method names to call, and how to turn that method's plain-JS return value
 * (i.e. already run through something like `stellar-sdk`'s `scValToNative`)
 * into this SDK's stable, version-independent shapes. The actual RPC
 * simulation stays in `apps/web/src/lib/receipt-anchor.ts`, which is the
 * thing that needs a Stellar RPC endpoint and knows how to build an
 * `xdr.ScVal`; this module is pure and portable on purpose; a future
 * embedder of `@accensa/sdk` gets ABI awareness without pulling in a Soroban
 * RPC client it may not want.
 */

/** The SDK's stable, version-independent view of an anchored batch. */
export interface BatchRecord {
  root: string;
  count: number;
  periodStart: number;
  periodEnd: number;
}

/**
 * Whatever a version's `get_batch`-equivalent method returns, already
 * decoded to plain JS (e.g. via `stellar-sdk`'s `scValToNative`) but not yet
 * reshaped into `BatchRecord`. Its keys are ABI-version-specific, which is
 * exactly why this type is a bag rather than a fixed interface.
 */
export type RawBatch = Record<string, unknown>;

/**
 * One ABI version's strategy: which contract methods to call, and how to
 * decode what they return.
 */
export interface ReceiptAnchorAbi {
  /** Identifies this version in the registry and in configuration/logs. */
  readonly version: string;
  /** Contract method name for reading an anchored batch. */
  readonly getBatchMethod: string;
  /** Contract method name for verifying a receipt against a batch. */
  readonly verifyReceiptMethod: string;
  /** Reshapes this version's raw `get_batch`-equivalent return value. */
  decodeBatch(raw: RawBatch): BatchRecord;
  /** Reshapes this version's raw `verify_receipt`-equivalent return value. */
  decodeVerifyResult(raw: unknown): boolean;
}

/** Bytes (however this version's client already decoded them) as lowercase hex. */
function toHex(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  throw new Error(`Expected a hex string or byte array, got ${typeof value}`);
}

/**
 * v1 - the ABI live at the address `RECEIPT_ANCHOR_ID` defaults to today:
 * `get_batch(batch_id) -> {root, count, period_start, period_end}` and
 * `verify_receipt(batch_id, leaf, proof) -> bool`. This is the only version
 * that has ever actually been deployed as of #172.
 */
const V1: ReceiptAnchorAbi = {
  version: 'v1',
  getBatchMethod: 'get_batch',
  verifyReceiptMethod: 'verify_receipt',
  decodeBatch(raw) {
    return {
      root: toHex(raw.root),
      count: Number(raw.count),
      periodStart: Number(raw.period_start),
      periodEnd: Number(raw.period_end),
    };
  },
  decodeVerifyResult(raw) {
    return raw === true;
  },
};

/**
 * v0 - a worked example of a *different* ABI, registered so the registry and
 * factory are exercised by more than a single trivial entry and so the next
 * real version has a template to copy. It is not a real deployed contract;
 * nothing in this codebase claims otherwise. It models the kind of change
 * that would actually require this abstraction: different method names
 * (`batch`/`verify` instead of `get_batch`/`verify_receipt`) and a different
 * return shape (`merkle_root`/`leaf_count`/`window_start`/`window_end`
 * instead of `root`/`count`/`period_start`/`period_end`) that still resolves
 * to the exact same `BatchRecord` on this side of the abstraction.
 */
const V0_EXAMPLE: ReceiptAnchorAbi = {
  version: 'v0-example',
  getBatchMethod: 'batch',
  verifyReceiptMethod: 'verify',
  decodeBatch(raw) {
    return {
      root: toHex(raw.merkle_root),
      count: Number(raw.leaf_count),
      periodStart: Number(raw.window_start),
      periodEnd: Number(raw.window_end),
    };
  },
  decodeVerifyResult(raw) {
    return raw === true;
  },
};

const registry = new Map<string, ReceiptAnchorAbi>([
  [V1.version, V1],
  [V0_EXAMPLE.version, V0_EXAMPLE],
]);

/** The version `createReceiptAnchorAbi()` resolves to when none is given. */
export const DEFAULT_RECEIPT_ANCHOR_ABI_VERSION = V1.version;

/** Every ABI version this SDK build knows how to speak. */
export function listReceiptAnchorAbiVersions(): string[] {
  return [...registry.keys()];
}

/**
 * Registers (or replaces) an ABI version's strategy.
 *
 * Exists so a consumer of this SDK - or a future release of it - can add
 * support for a contract version this file doesn't ship a built-in entry
 * for, without forking the package.
 */
export function registerReceiptAnchorAbi(abi: ReceiptAnchorAbi): void {
  registry.set(abi.version, abi);
}

/**
 * Factory: returns the strategy for one ABI version.
 *
 * Throws for a version this SDK build doesn't know, rather than guessing -
 * silently falling back to `v1`'s method names and field layout against a
 * contract that doesn't speak them is exactly the kind of ABI mismatch this
 * registry exists to catch, and it is better caught here, loudly, than as a
 * confusing simulation error three calls later.
 */
export function createReceiptAnchorAbi(
  version: string = DEFAULT_RECEIPT_ANCHOR_ABI_VERSION,
): ReceiptAnchorAbi {
  const abi = registry.get(version);
  if (!abi) {
    throw new Error(
      `Unknown ReceiptAnchor ABI version "${version}". Known versions: ${listReceiptAnchorAbiVersions().join(', ')}. ` +
        'Register it with registerReceiptAnchorAbi() or upgrade @accensa/sdk.',
    );
  }
  return abi;
}
