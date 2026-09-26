import { describe, it, expect } from 'vitest';
import {
  createReceiptAnchorAbi,
  registerReceiptAnchorAbi,
  listReceiptAnchorAbiVersions,
  describeValue,
  ReceiptAnchorAbiError,
  DEFAULT_RECEIPT_ANCHOR_ABI_VERSION,
  type ReceiptAnchorAbi,
  type ReceiptAnchorAbiErrorCode,
} from './receipt-anchor';

/**
 * Test suite for the ReceiptAnchor ABI version registry (#172, hardened in
 * #379).
 *
 * The registry (see `receipt-anchor.ts`) is the bridge between this SDK's
 * stable, version-independent shapes (`BatchRecord` / boolean verify result)
 * and the raw method names + field layouts of whatever `ReceiptAnchor`
 * contract deployment is being talked to. These tests pin down:
 *
 *  1. the default version a caller gets when none is specified,
 *  2. the exact method names and raw->stable reshapes v1 performs,
 *  3. the registry's lookups, error behavior, and extension points,
 *  4. backwards compatibility: that a differently-shaped legacy ABI still
 *     resolves to the same stable shapes on this side of the abstraction,
 *  5. every failure mode, asserted on the typed
 *     {@link ReceiptAnchorAbiError} rather than on message text (#379).
 *
 * ## Testing strategy for failures (#379)
 *
 * The registry's job is to fail *predictably*: a wrong ABI version, a root
 * that is not hex, and a `count` that did not decode are all configuration
 * or data problems, and each has exactly one place where it can be named
 * with the version and the field that produced it. This suite therefore
 * asserts three things per failure, never just "it threw":
 *
 *  - the {@link ReceiptAnchorAbiErrorCode}, so a caller can branch on the
 *    failure without matching prose;
 *  - the message, which must name both the ABI version and the raw field -
 *    a message that cannot be acted on is treated as a failure here;
 *  - `version` / `field` / `received` on the error, so the offending value
 *    travels with the throw instead of being logged somewhere else.
 *
 * Every registry mutation is scoped with the disposer
 * {@link registerReceiptAnchorAbi} returns, and each suite that mutates
 * asserts the registry is byte-identical afterwards. Without that, a test that
 * registers a version silently changes what every later assertion in the same
 * worker sees.
 *
 * This file contains no network I/O and never touches a Stellar RPC
 * endpoint; every test exercises the pure, portable registry module.
 */

/**
 * Runs `fn`, requires it to throw a {@link ReceiptAnchorAbiError} with the
 * expected code, and returns it for further assertions.
 *
 * Also pins the two things a caller can rely on: the error is still an
 * `instanceof Error` (a pre-existing `catch` keeps working) and its message
 * names both the ABI version and the raw field, so it is actionable without
 * a stack trace.
 */
function expectAbiError(
  fn: () => unknown,
  expected: { code: ReceiptAnchorAbiErrorCode; version?: string; field?: string },
): ReceiptAnchorAbiError {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`expected a ${expected.code} ReceiptAnchorAbiError, but nothing was thrown`);
  }
  expect(thrown).toBeInstanceOf(ReceiptAnchorAbiError);
  expect(thrown).toBeInstanceOf(Error);

  const error = thrown as ReceiptAnchorAbiError;
  expect(error.name).toBe('ReceiptAnchorAbiError');
  expect(error.code).toBe(expected.code);

  if (expected.version !== undefined) {
    expect(error.version).toBe(expected.version);
    expect(error.message).toContain(expected.version);
  }
  if (expected.field !== undefined) {
    expect(error.field).toBe(expected.field);
    expect(error.message).toContain(expected.field);
  }
  return error;
}

/** A raw v1 `get_batch` return value, so each test overrides only what it exercises. */
function rawV1Batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { root: 'a'.repeat(64), count: 3, period_start: 100, period_end: 200, ...overrides };
}

/** A raw v0-example return value, in that version's own field names. */
function rawV0Batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    merkle_root: 'b'.repeat(64),
    leaf_count: 5,
    window_start: 10,
    window_end: 20,
    ...overrides,
  };
}

/** Asserts the registry is exactly as it was before the enclosing test ran. */
async function withRegistryScopedTo<T>(run: () => Promise<T> | T): Promise<T> {
  const before = [...listReceiptAnchorAbiVersions()];
  try {
    return await run();
  } finally {
    expect(listReceiptAnchorAbiVersions()).toEqual(before);
  }
}

/** Asserts defaulting and the exact v1 method names, matching the deployed contract. */
describe('createReceiptAnchorAbi', () => {
  it('defaults to the current (v1) ABI version', () => {
    const abi = createReceiptAnchorAbi();
    expect(abi.version).toBe(DEFAULT_RECEIPT_ANCHOR_ABI_VERSION);
    expect(abi.version).toBe('v1');
  });

  it('v1 uses the method names the deployed ReceiptAnchor contract exposes', () => {
    const abi = createReceiptAnchorAbi('v1');
    expect(abi.getBatchMethod).toBe('get_batch');
    expect(abi.verifyReceiptMethod).toBe('verify_receipt');
  });

  it('v1 decodes a batch return value into the stable BatchRecord shape', () => {
    const abi = createReceiptAnchorAbi('v1');
    const record = abi.decodeBatch({
      root: 'a'.repeat(64),
      count: 3,
      period_start: 100,
      period_end: 200,
    });
    expect(record).toEqual({
      root: 'a'.repeat(64),
      count: 3,
      periodStart: 100,
      periodEnd: 200,
    });
  });

  it('v1 hex-encodes a raw byte-array root', () => {
    const abi = createReceiptAnchorAbi('v1');
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const record = abi.decodeBatch(rawV1Batch({ root: bytes }));
    expect(record.root).toBe('deadbeef');
  });

  it('normalizes an uppercase hex root to lowercase', () => {
    const abi = createReceiptAnchorAbi('v1');
    // XDR hex comes back in whatever case the provider used; the stable
    // BatchRecord is lowercase, so a receipt verified against one root must
    // not stop verifying because the other endpoint answered in upper case.
    expect(abi.decodeBatch(rawV1Batch({ root: 'A'.repeat(64) })).root).toBe('a'.repeat(64));
  });

  it('accepts a bigint count, as a u64 decodes when a caller asks for BigInt', () => {
    const abi = createReceiptAnchorAbi('v1');
    expect(abi.decodeBatch(rawV1Batch({ count: 3n })).count).toBe(3);
  });

  it('decodes verify_receipt result strictly - only `true` counts', () => {
    const abi = createReceiptAnchorAbi('v1');
    expect(abi.decodeVerifyResult(true)).toBe(true);
    expect(abi.decodeVerifyResult(false)).toBe(false);
    expect(abi.decodeVerifyResult(undefined)).toBe(false);
    expect(abi.decodeVerifyResult('true')).toBe(false);
  });

  it('lists at least the default version among known versions', () => {
    expect(listReceiptAnchorAbiVersions()).toContain(DEFAULT_RECEIPT_ANCHOR_ABI_VERSION);
  });

  it('returns a defensive copy of the version list', () => {
    const versions = listReceiptAnchorAbiVersions();
    versions.push('v-not-registered');
    expect(listReceiptAnchorAbiVersions()).not.toContain('v-not-registered');
  });
});

/**
 * The unknown-version failure (#379).
 *
 * The one failure mode the registry could not report without help: guessing a
 * method name is exactly what this module exists to prevent, so the throw
 * has to be unambiguous and has to list what *is* available.
 */
describe('unknown ABI version', () => {
  it('rejects an unregistered version with a typed error', () => {
    const error = expectAbiError(() => createReceiptAnchorAbi('v99'), {
      code: 'unknown_version',
      version: 'v99',
    });
    expect(error.received).toBe('v99');
  });

  it('names the known versions and how to add one, so the message is actionable', () => {
    let message = '';
    try {
      createReceiptAnchorAbi('v99');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Unknown ReceiptAnchor ABI version "v99"/);
    for (const known of listReceiptAnchorAbiVersions()) {
      expect(message).toContain(known);
    }
    expect(message).toContain('registerReceiptAnchorAbi()');
  });

  it('rejects an empty version string the same way, rather than falling back to v1', () => {
    // `createReceiptAnchorAbi('')` must not be treated as "no version given":
    // that would reintroduce the silent fallback this registry was built to
    // remove, for the one input a misconfiguration is most likely to produce.
    expectAbiError(() => createReceiptAnchorAbi(''), { code: 'unknown_version', version: '' });
  });
});

/**
 * The undecodable-root failure (#379).
 *
 * A `root` that is not hex used to be returned as-is. Nothing complained at
 * the boundary, and the mismatch surfaced later as a Merkle verification
 * failure naming neither the ABI version nor the field - the least
 * diagnosable place for it to appear.
 */
describe('undecodable batch root', () => {
  const v1 = () => createReceiptAnchorAbi('v1');

  it('rejects a missing root instead of returning undefined', () => {
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: undefined })), {
      code: 'undecodable_root',
      version: 'v1',
      field: 'root',
    });
    expect(error.received).toBeUndefined();
    expect(error.message).toContain('undefined');
  });

  it('rejects a null root, naming it as null rather than as an opaque object', () => {
    // The old message used `typeof value`, which reports `object` for null,
    // for an array and for a Uint8Array alike.
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: null })), {
      code: 'undecodable_root',
      field: 'root',
    });
    expect(error.message).toContain('null');
    expect(error.message).not.toContain('object');
  });

  it('rejects a non-hex string and shows what arrived', () => {
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: 'z'.repeat(64) })), {
      code: 'undecodable_root',
      field: 'root',
    });
    expect(error.message).toContain('hex string');
  });

  it('rejects a base64 string rather than passing it through as a root', () => {
    // A caller that base64-encoded the root is a real possibility; the
    // failure must be here rather than in a Merkle comparison three calls on.
    expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: 'aGVsbG8gd29ybGQ=' })), {
      code: 'undecodable_root',
      field: 'root',
    });
  });

  it('rejects an odd-length hex string', () => {
    // `Buffer.from('abc', 'hex')` silently truncates to one byte, so an
    // odd-length root is a corruption, not a shorter root.
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: 'abc' })), {
      code: 'undecodable_root',
      field: 'root',
    });
    expect(error.message).toContain('even-length');
  });

  it('rejects a number and a plain object, describing each', () => {
    // A byte *array* is a legitimate root (see the fallbacks suite), so the
    // values here are the ones that are neither hex nor bytes.
    expect(
      expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: 42 })), {
        code: 'undecodable_root',
        field: 'root',
      }).message,
    ).toContain('number (42)');

    expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: { hex: 'ab' } })), {
      code: 'undecodable_root',
      field: 'root',
    });
  });

  it('rejects a byte array holding an out-of-range byte', () => {
    // `[300]` is a byte array in nothing but name; encoding it would produce
    // a plausible-looking root that is not the contract's.
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: [300] })), {
      code: 'undecodable_root',
      field: 'root',
    });
    expect(error.message).toContain('array(1)');
  });

  it('blames the v0 field name, and v0, when v0-example is the version being decoded', () => {
    const error = expectAbiError(
      () => createReceiptAnchorAbi('v0-example').decodeBatch(rawV0Batch({ merkle_root: null })),
      { code: 'undecodable_root', version: 'v0-example', field: 'merkle_root' },
    );
    expect(error.message).toContain('v0-example');
  });
});

/**
 * The undecodable-number failure (#379).
 *
 * `Number(raw.count)` used to be the whole conversion, so a missing or
 * malformed `count` became `NaN` in a `BatchRecord` that otherwise looked
 * complete - the silent failure this file is named for.
 */
describe('undecodable batch counts', () => {
  const v1 = () => createReceiptAnchorAbi('v1');

  it('rejects a missing count rather than reporting NaN', () => {
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ count: undefined })), {
      code: 'undecodable_number',
      version: 'v1',
      field: 'count',
    });
    expect(error.received).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a non-numeric string', 'many'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a fractional number', 1.5],
    ['a boolean', true],
    ['an object', {}],
  ])('rejects %s as a count', (_label, value) => {
    const error = expectAbiError(() => v1().decodeBatch(rawV1Batch({ count: value })), {
      code: 'undecodable_number',
      field: 'count',
    });
    expect(error.message).toContain('finite integer');
  });

  it('names the period bounds by their own raw field names', () => {
    // The three numeric fields are decoded independently, so an error has to
    // say which one it was; "count" on a period_end failure sends the reader
    // to the wrong contract layout entirely.
    expectAbiError(() => v1().decodeBatch(rawV1Batch({ period_start: undefined })), {
      code: 'undecodable_number',
      field: 'period_start',
    });
    expectAbiError(() => v1().decodeBatch(rawV1Batch({ period_end: undefined })), {
      code: 'undecodable_number',
      field: 'period_end',
    });
  });

  it('blames the v0 field name when v0-example is the version being decoded', () => {
    expectAbiError(
      () => createReceiptAnchorAbi('v0-example').decodeBatch(rawV0Batch({ leaf_count: undefined })),
      { code: 'undecodable_number', version: 'v0-example', field: 'leaf_count' },
    );
  });

  it('reports the first bad field and does not decode a partial record', () => {
    // Every failure throws, so a caller never receives a half-decoded
    // BatchRecord that looks usable.
    expectAbiError(() => v1().decodeBatch(rawV1Batch({ root: 'nope', count: undefined })), {
      code: 'undecodable_root',
      field: 'root',
    });
  });
});

/**
 * The byte-shape fallbacks (#379).
 *
 * `Buffer` is a Node global and this module is imported by browser and React
 * Native consumers, where it does not exist. The old `Buffer.from(...)` threw
 * a bare `ReferenceError: Buffer is not defined` there, naming neither the
 * ABI version nor the field. Hex encoding now falls back to a plain loop, and
 * every byte-shaped input decodes identically with or without `Buffer`.
 */
describe('byte-shape decoding fallbacks', () => {
  const v1 = () => createReceiptAnchorAbi('v1');
  const HEXED = [0x00, 0x0f, 0xa9, 0xff];

  /** Runs `run` with `Buffer` removed from `globalThis`, then restores it. */
  async function withoutBuffer<T>(run: () => T | Promise<T>): Promise<T> {
    const original = globalThis.Buffer;
    // @ts-expect-error - deliberately simulating a runtime without Node globals.
    delete globalThis.Buffer;
    try {
      return await run();
    } finally {
      globalThis.Buffer = original;
    }
  }

  it('encodes a Uint8Array root without Buffer', async () => {
    const root = await withoutBuffer(() =>
      v1().decodeBatch(rawV1Batch({ root: Uint8Array.from(HEXED) })),
    );
    expect(root.root).toBe('000fa9ff');
  });

  it('produces identical output with and without Buffer', async () => {
    // Both runs decode the same bytes; only the availability of `Buffer`
    // differs. A `Buffer` is a `Uint8Array`, so the bytes are built up front
    // rather than with `Buffer.from` inside the `Buffer`-less run.
    const bytes = Buffer.from(HEXED);
    const withBuffer = v1().decodeBatch(rawV1Batch({ root: bytes })).root;
    const without = await withoutBuffer(() => v1().decodeBatch(rawV1Batch({ root: bytes })).root);
    expect(without).toBe(withBuffer);
  });

  it('decodes an ArrayBuffer root', () => {
    const buffer = Uint8Array.from(HEXED).buffer;
    expect(v1().decodeBatch(rawV1Batch({ root: buffer })).root).toBe('000fa9ff');
  });

  it('decodes an ArrayBufferView root, honouring its byteOffset', () => {
    // A view into the middle of a larger buffer must not read its neighbours.
    const padded = Uint8Array.from([0xff, 0xff, ...HEXED, 0xff, 0xff]);
    const view = new DataView(padded.buffer, 2, HEXED.length);
    expect(v1().decodeBatch(rawV1Batch({ root: view })).root).toBe('000fa9ff');
  });

  it('decodes a plain byte array root', () => {
    expect(v1().decodeBatch(rawV1Batch({ root: HEXED })).root).toBe('000fa9ff');
  });

  it('decodes an empty byte array as an empty root', () => {
    // Zero bytes is a valid (if useless) root, not an error; the contract is
    // the only authority on whether a batch may have one.
    expect(v1().decodeBatch(rawV1Batch({ root: new Uint8Array([]) })).root).toBe('');
  });
});

/** `describeValue` is part of the error contract, so it is tested directly. */
describe('describeValue', () => {
  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['an empty array', [], 'array(0)'],
    ['a populated array', [1, 2, 3], 'array(3)'],
    ['NaN', Number.NaN, 'number (NaN)'],
    ['a finite number', 42, 'number (42)'],
    ['a bigint', 7n, 'bigint (7)'],
    ['a string', 'ab', 'string ("ab")'],
    ['a byte array', new Uint8Array(3), 'Uint8Array(3 bytes)'],
    ['an ArrayBuffer', new ArrayBuffer(8), 'ArrayBuffer(8 bytes)'],
    ['a DataView', new DataView(new ArrayBuffer(4)), 'DataView(4 bytes)'],
    ['a boolean', true, 'boolean'],
  ])('describes %s', (_label, value, expected) => {
    expect(describeValue(value)).toBe(expected);
  });

  it('truncates a long string rather than embedding a whole root in the message', () => {
    const described = describeValue('a'.repeat(200));
    expect(described.length).toBeLessThan(80);
    expect(described).toContain('…');
  });
});

/**
 * Backwards-compatibility guarantees of the registry.
 *
 * The whole point of the registry is that two contract versions with
 * different method names and different raw field layouts both resolve to
 * the exact same BatchRecord/boolean shape on this side of the
 * abstraction - a caller (apps/web's receipt-anchor.ts) drives whichever
 * methods `abi.getBatchMethod`/`abi.verifyReceiptMethod` name, and reads
 * back a BatchRecord without knowing which version answered.
 *
 * These tests lock the property "different ABI in, identical shape out"
 * so a future version bump cannot silently leak its raw layout to callers.
 */
describe('backwards compatibility across ABI versions', () => {
  it('the built-in example legacy version uses different method names than v1', () => {
    const legacy = createReceiptAnchorAbi('v0-example');
    const current = createReceiptAnchorAbi('v1');
    expect(legacy.getBatchMethod).not.toBe(current.getBatchMethod);
    expect(legacy.verifyReceiptMethod).not.toBe(current.verifyReceiptMethod);
  });

  it('the built-in example legacy version decodes a differently-shaped raw batch to the same BatchRecord', () => {
    const legacy = createReceiptAnchorAbi('v0-example');
    const current = createReceiptAnchorAbi('v1');

    // Same underlying batch, but v0's raw layout names its fields
    // differently (`merkle_root`/`leaf_count`/`window_*` vs
    // `root`/`count`/`period_*`). Both must reshape to the stable shape.
    const legacyRaw = {
      merkle_root: 'b'.repeat(64),
      leaf_count: 5,
      window_start: 10,
      window_end: 20,
    };
    const currentRaw = { root: 'b'.repeat(64), count: 5, period_start: 10, period_end: 20 };

    expect(legacy.decodeBatch(legacyRaw)).toEqual(current.decodeBatch(currentRaw));
  });

  it('a caller can drive get_batch/verify_receipt for any registered version without knowing its shape upfront', () => {
    // Simulates what apps/web/src/lib/receipt-anchor.ts does: look up the
    // strategy once by a configured version string, then call generically.
    // This is the "one interface, many versions" property that lets callers
    // write version-agnostic code.
    function fakeContractCall(abi: ReceiptAnchorAbi, method: string): unknown {
      if (method === abi.getBatchMethod) {
        // Route by the *registered* method name so each version's wired-up
        // raw shape is exercised, exactly as the real contract client does.
        return abi === createReceiptAnchorAbi('v1')
          ? { root: 'c'.repeat(64), count: 1, period_start: 1, period_end: 2 }
          : { merkle_root: 'c'.repeat(64), leaf_count: 1, window_start: 1, window_end: 2 };
      }
      throw new Error(`unexpected method ${method}`);
    }

    for (const version of ['v1', 'v0-example']) {
      const abi = createReceiptAnchorAbi(version);
      const raw = fakeContractCall(abi, abi.getBatchMethod) as Record<string, unknown>;
      expect(abi.decodeBatch(raw)).toEqual({
        root: 'c'.repeat(64),
        count: 1,
        periodStart: 1,
        periodEnd: 2,
      });
    }
  });
});

/**
 * The registry's extension point, and the state it leaks (#379).
 *
 * The registry is a module-global `Map`, so a registration made to exercise
 * one code path outlives the test that made it and changes what every later
 * assertion in the same worker sees. `registerReceiptAnchorAbi` therefore
 * returns a disposer, and these tests hold it to that contract: the registry
 * is byte-identical before and after, whether the call added or replaced an
 * entry.
 */
describe('registerReceiptAnchorAbi', () => {
  /** A caller-supplied strategy for a version this SDK build does not ship. */
  const hypothetical: ReceiptAnchorAbi = {
    version: 'v2-hypothetical',
    getBatchMethod: 'get_batch_v2',
    verifyReceiptMethod: 'verify_receipt_v2',
    decodeBatch: (raw) => ({
      root: String(raw.root),
      count: Number(raw.count),
      periodStart: Number(raw.period_start),
      periodEnd: Number(raw.period_end),
    }),
    decodeVerifyResult: (raw) => raw === true,
  };

  it('lets a caller add support for a version this SDK build does not ship', () =>
    withRegistryScopedTo(() => {
      // Unknown versions fail fast by default...
      expect(() => createReceiptAnchorAbi('v2-hypothetical')).toThrow();

      // ...and the registry's open extension point lets a consumer teach the
      // SDK a future (or private) contract version at runtime, without forking.
      const restore = registerReceiptAnchorAbi(hypothetical);
      try {
        const abi = createReceiptAnchorAbi('v2-hypothetical');
        expect(abi.getBatchMethod).toBe('get_batch_v2');
        expect(listReceiptAnchorAbiVersions()).toContain('v2-hypothetical');
      } finally {
        restore();
      }
    }));

  it('removes an added version again when the disposer runs', () => {
    const before = [...listReceiptAnchorAbiVersions()];
    const restore = registerReceiptAnchorAbi(hypothetical);
    expect(listReceiptAnchorAbiVersions()).toEqual([...before, 'v2-hypothetical']);
    restore();
    expect(listReceiptAnchorAbiVersions()).toEqual(before);
    expect(() => createReceiptAnchorAbi('v2-hypothetical')).toThrow();
  });

  it('restores the entry it replaced, rather than deleting it', () => {
    const original = createReceiptAnchorAbi('v1');
    const replacement: ReceiptAnchorAbi = { ...hypothetical, version: 'v1' };
    const restore = registerReceiptAnchorAbi(replacement);
    try {
      expect(createReceiptAnchorAbi('v1')).toBe(replacement);
    } finally {
      restore();
    }
    // The built-in v1 is back, not a hole where it used to be.
    expect(createReceiptAnchorAbi('v1')).toBe(original);
  });

  it('is idempotent when the disposer runs twice', () => {
    // A `finally` block that also ran on an error path would otherwise
    // restore a stale entry and fail here, far from the mistake.
    const before = [...listReceiptAnchorAbiVersions()];
    const restore = registerReceiptAnchorAbi(hypothetical);
    restore();
    expect(() => restore()).not.toThrow();
    expect(listReceiptAnchorAbiVersions()).toEqual(before);
  });
});
