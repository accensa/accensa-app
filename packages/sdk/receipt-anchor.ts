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
 *
 * ## Failure modes (#379)
 *
 * Every way this module can fail throws a {@link ReceiptAnchorAbiError}
 * carrying a machine-readable {@link ReceiptAnchorAbiErrorCode} alongside the
 * message, rather than a bare `Error` or - worse - a silently mangled
 * {@link BatchRecord}. An ABI mismatch is a *configuration* problem, and the
 * whole value of this registry is that it is caught at the boundary where the
 * version is chosen rather than three calls later as a `NaN` batch count or a
 * root that is not hex. In particular:
 *
 * - a root that is not valid hex is rejected, not passed through;
 * - a `count`/period bound that does not coerce to a finite integer is
 *   rejected, not silently turned into `NaN`;
 * - a version nobody registered is rejected with the list of versions that
 *   *are* known, so the fix is obvious from the message.
 *
 * Because this module is imported by browser and React Native code, nothing
 * here may depend on a Node-only global: hex encoding falls back to a plain
 * byte-to-hex loop when `Buffer` is absent, and both `Buffer` and a bare
 * `Uint8Array` decode identically.
 */

/**
 * Machine-readable discriminator for every {@link ReceiptAnchorAbiError}.
 *
 * - `unknown_version` — no ABI strategy is registered under the requested
 *   version. The registry lookup failed; nothing was decoded.
 * - `undecodable_root` — a batch's root was not hex, or not the bytes a
 *   caller could reasonably have meant by "hex".
 * - `undecodable_number` — a count or period bound did not coerce to a finite
 *   integer, which is what a `NaN` count always turns out to be.
 */
export type ReceiptAnchorAbiErrorCode =
  'unknown_version' | 'undecodable_root' | 'undecodable_number';

/** Extra context attached to a {@link ReceiptAnchorAbiError}. */
export interface ReceiptAnchorAbiErrorContext {
  /** The ABI version being decoded, when one was known. */
  version?: string;
  /** The raw field that could not be decoded, e.g. `root` or `count`. */
  field?: string;
  /** The offending value, rendered for humans by {@link describeValue}. */
  received?: unknown;
}

/**
 * The single error type this module throws.
 *
 * Extends `Error` so an existing `catch` keeps working, and carries a
 * {@link code} so a caller can branch on the failure without matching on
 * message text.
 */
export class ReceiptAnchorAbiError extends Error {
  readonly code: ReceiptAnchorAbiErrorCode;
  /** The ABI version being decoded, when one was known. */
  readonly version?: string;
  /** The raw field that could not be decoded, e.g. `root` or `count`. */
  readonly field?: string;
  /** The offending value, exactly as it arrived. */
  readonly received?: unknown;

  constructor(
    code: ReceiptAnchorAbiErrorCode,
    message: string,
    context: ReceiptAnchorAbiErrorContext = {},
  ) {
    super(message);
    this.name = 'ReceiptAnchorAbiError';
    this.code = code;
    this.version = context.version;
    this.field = context.field;
    this.received = context.received;
  }
}

/**
 * Renders a value for an error message.
 *
 * `typeof` alone is what the old error path used, and it reports `object` for
 * `null`, for an array, and for a `Uint8Array` alike - which is exactly the
 * information a caller needs and never gets. This names the difference.
 */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'number') return Number.isNaN(value) ? 'number (NaN)' : `number (${value})`;
  if (typeof value === 'bigint') return `bigint (${value})`;
  if (typeof value === 'string') {
    const shown = value.length > 32 ? `${value.slice(0, 32)}…` : value;
    return `string (${JSON.stringify(shown)})`;
  }
  if (value instanceof Uint8Array) return `Uint8Array(${value.length} bytes)`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength} bytes)`;
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}(${value.byteLength} bytes)`;
  }
  return typeof value;
}

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

/** A hex string is only hex if it is even-length and entirely hex digits. */
const HEX = /^[0-9a-fA-F]*$/;

/** Lowcase hex for one byte. `toString(16)` is padded by hand below. */
const BYTE_TO_HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/**
 * Hex-encodes bytes without `Buffer`.
 *
 * `Buffer` is a Node global. This module is imported by browser and React
 * Native consumers, where it is absent, and a bare `Buffer.from(...)` there
 * throws a `ReferenceError` that names neither the ABI version nor the field
 * that was being decoded. Prefer `Buffer` when it exists, fall back to this
 * otherwise, and produce identical output either way.
 */
function bytesToHex(bytes: Uint8Array): string {
  const buffer = (
    globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }
  ).Buffer;
  if (buffer) return buffer.from(bytes).toString('hex');

  let out = '';
  for (const byte of bytes) out += BYTE_TO_HEX[byte];
  return out;
}

/** Coerces anything byte-shaped into a `Uint8Array`, or returns `undefined`. */
function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  return undefined;
}

/**
 * Bytes (however this version's client already decoded them) as lowercase hex.
 *
 * Accepts a hex string or any byte-shaped value. A string is *validated*
 * rather than trusted: the previous version returned whatever string it was
 * given, so a contract (or a caller) that answered with a base64 or truncated
 * root produced a `BatchRecord` whose `root` was not hex at all, and the
 * mismatch only surfaced later as an unrelated Merkle failure. Rejecting it
 * here names the ABI version and the field, which is the only place that
 * knows both.
 *
 * @throws {ReceiptAnchorAbiError} `undecodable_root` for anything else.
 */
function toHex(value: unknown, ctx: { version: string; field: string }): string {
  if (typeof value === 'string') {
    if (!HEX.test(value) || value.length % 2 !== 0) {
      throw new ReceiptAnchorAbiError(
        'undecodable_root',
        `ReceiptAnchor ABI ${ctx.version}: ${ctx.field} must be an even-length hex string, ` +
          `got ${describeValue(value)}.`,
        { ...ctx, received: value },
      );
    }
    return value.toLowerCase();
  }

  const bytes = asBytes(value);
  if (bytes) return bytesToHex(bytes);

  throw new ReceiptAnchorAbiError(
    'undecodable_root',
    `ReceiptAnchor ABI ${ctx.version}: ${ctx.field} must be a hex string or a byte array, ` +
      `got ${describeValue(value)}.`,
    { ...ctx, received: value },
  );
}

/**
 * Coerces a decoded `u64`/number to a finite integer.
 *
 * `Number(raw.count)` is what this used to do, and it turns a missing or
 * malformed field into `NaN` - a `BatchRecord` that looks populated and is
 * not. Soroban `u64` values arrive as `number` or `bigint` depending on how
 * the caller decoded them, so both are accepted; anything that is not a
 * finite integer is an error rather than a `NaN` that travels.
 *
 * @throws {ReceiptAnchorAbiError} `undecodable_number` for anything else.
 */
function toCount(value: unknown, ctx: { version: string; field: string }): number {
  // `Number.isInteger` is false for NaN and both infinities, so one check
  // covers "not a number", "not finite" and "not whole".
  const n = Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isInteger(n)) {
    throw new ReceiptAnchorAbiError(
      'undecodable_number',
      `ReceiptAnchor ABI ${ctx.version}: ${ctx.field} must be a finite integer, ` +
        `got ${describeValue(value)}.`,
      { ...ctx, received: value },
    );
  }
  return n;
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
    const ctx = { version: V1.version };
    return {
      root: toHex(raw.root, { ...ctx, field: 'root' }),
      count: toCount(raw.count, { ...ctx, field: 'count' }),
      periodStart: toCount(raw.period_start, { ...ctx, field: 'period_start' }),
      periodEnd: toCount(raw.period_end, { ...ctx, field: 'period_end' }),
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
    const ctx = { version: V0_EXAMPLE.version };
    return {
      root: toHex(raw.merkle_root, { ...ctx, field: 'merkle_root' }),
      count: toCount(raw.leaf_count, { ...ctx, field: 'leaf_count' }),
      periodStart: toCount(raw.window_start, { ...ctx, field: 'window_start' }),
      periodEnd: toCount(raw.window_end, { ...ctx, field: 'window_end' }),
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
 *
 * The registry is module-global, so a registration made to exercise one code
 * path otherwise leaks into every later lookup in the same process. The
 * returned function undoes exactly this call - restoring the entry it
 * replaced, or removing the entry it added - so a caller (a test, or a
 * server that re-configures itself) can scope a registration:
 *
 * ```ts
 * const restore = registerReceiptAnchorAbi(myV2);
 * try {
 *   createReceiptAnchorAbi('v2');
 * } finally {
 *   restore();
 * }
 * ```
 */
export function registerReceiptAnchorAbi(abi: ReceiptAnchorAbi): () => void {
  const previous = registry.get(abi.version);
  registry.set(abi.version, abi);
  return () => {
    if (previous) registry.set(abi.version, previous);
    else registry.delete(abi.version);
  };
}

/**
 * Factory: returns the strategy for one ABI version.
 *
 * Throws for a version this SDK build doesn't know, rather than guessing -
 * silently falling back to `v1`'s method names and field layout against a
 * contract that doesn't speak them is exactly the kind of ABI mismatch this
 * registry exists to catch, and it is better caught here, loudly, than as a
 * confusing simulation error three calls later.
 *
 * @throws {ReceiptAnchorAbiError} `unknown_version`, listing the known versions.
 */
export function createReceiptAnchorAbi(
  version: string = DEFAULT_RECEIPT_ANCHOR_ABI_VERSION,
): ReceiptAnchorAbi {
  const abi = registry.get(version);
  if (!abi) {
    throw new ReceiptAnchorAbiError(
      'unknown_version',
      `Unknown ReceiptAnchor ABI version "${version}". Known versions: ${listReceiptAnchorAbiVersions().join(', ')}. ` +
        'Register it with registerReceiptAnchorAbi() or upgrade @accensa/sdk.',
      { version, received: version },
    );
  }
  return abi;
}
