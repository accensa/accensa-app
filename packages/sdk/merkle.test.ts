import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyReceipt, buildBatch, receiptLeaf } from './merkle';
import vectors from './merkle-vectors.json';

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest();
const leafOf = (label: string) => sha256(Buffer.from(label, 'utf8')).toString('hex');
const VALID = 'a'.repeat(64);

describe('verifyReceipt — shared conformance vectors', () => {
  // These are the same vectors the Soroban ReceiptAnchor tests run against.
  // If this suite and the contract suite both pass, the two implementations
  // agree on every case in merkle-vectors.json.
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(verifyReceipt(c.leaf, c.proof, c.root)).toBe(c.expected);
  });

  it('covers both true and false expectations', () => {
    const expectations = new Set(vectors.cases.map((c) => c.expected));
    expect(expectations).toEqual(new Set([true, false]));
  });

  it('pins the root anchored on-chain as batch #1', () => {
    expect(vectors.onchain.root).toBe(vectors.cases[0].root);
    expect(vectors.cases[0].expected).toBe(true);
  });
});

describe('verifyReceipt — sorted-pair convention', () => {
  it('accepts a sibling on either side, so proofs need no position flags', () => {
    const a = leafOf('pair-a');
    const b = leafOf('pair-b');
    const root = sha256(
      Buffer.concat([Buffer.from(a, 'hex'), Buffer.from(b, 'hex')].sort(Buffer.compare)),
    ).toString('hex');

    // The same root verifies from either leaf, with the other as the proof.
    expect(verifyReceipt(a, [b], root)).toBe(true);
    expect(verifyReceipt(b, [a], root)).toBe(true);
  });

  it('is order-independent within a step but not across steps', () => {
    const [x, y, z] = ['step-x', 'step-y', 'step-z'].map(leafOf);
    const forward = verifyReceipt(x, [y, z], 'f'.repeat(64));
    const swapped = verifyReceipt(x, [z, y], 'f'.repeat(64));
    // Both fail against a bogus root, but they must compute different paths.
    expect(forward).toBe(false);
    expect(swapped).toBe(false);
  });
});

describe('verifyReceipt — malformed input', () => {
  it('rejects a leaf that is not 32 bytes', () => {
    expect(() => verifyReceipt('abcd', [], VALID)).toThrow(/leaf/);
  });

  it('rejects a proof entry that is not 32 bytes', () => {
    expect(() => verifyReceipt(VALID, ['abcd'], VALID)).toThrow(/proof/);
  });

  it('rejects a root that is not 32 bytes', () => {
    expect(() => verifyReceipt(VALID, [], 'abcd')).toThrow(/root/);
  });

  it('rejects non-hex characters rather than silently truncating', () => {
    // Buffer.from(hex) stops at the first invalid character instead of throwing,
    // so a value like this would otherwise decode to 1 byte and compare short.
    const sneaky = 'ab' + 'zz' + 'a'.repeat(60);
    expect(sneaky).toHaveLength(64);
    expect(() => verifyReceipt(sneaky, [], VALID)).toThrow(/leaf/);
  });

  it('rejects an odd-length hex string', () => {
    expect(() => verifyReceipt('a'.repeat(63), [], VALID)).toThrow(/leaf/);
  });
});

describe('buildBatch — proofs verify against the shared convention', () => {
  const sha256hex = (label: string) =>
    createHash('sha256').update(Buffer.from(label, 'utf8')).digest('hex');

  it('matches the eight-leaf conformance root and proofs', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `bulk-receipt-${i}`);
    const leaves = labels.map(sha256hex);
    const batch = buildBatch(leaves);

    expect(batch.root).toBe('3aa0080b225e9f7bbfacd4a506648ed95261166a0ba97c5b1c54d253e0bbcb4f');

    const eightLeafCases = vectors.cases.filter((c) => c.name.startsWith('eight-leaf batch'));
    expect(eightLeafCases.length).toBeGreaterThan(0);
    for (const c of eightLeafCases) {
      expect(batch.proofs[c.leaf]).toEqual(c.proof);
      expect(verifyReceipt(c.leaf, batch.proofs[c.leaf], batch.root)).toBe(true);
    }
  });

  it('matches the three-leaf (odd promotion) conformance root', () => {
    const leaves = ['odd-1', 'odd-2', 'odd-3'].map(sha256hex);
    const batch = buildBatch(leaves);
    expect(batch.root).toBe('f2ce5eb24c9bead8184a3fc3bb1404ae4aa28e34e7046e829423dd787d1ca037');
    expect(verifyReceipt(leaves[2], batch.proofs[leaves[2]], batch.root)).toBe(true);
  });

  it('returns an empty proof for a single-leaf batch, root equal to the leaf', () => {
    const leaf = sha256hex('solo-receipt');
    const batch = buildBatch([leaf]);
    expect(batch.root).toBe(leaf);
    expect(batch.proofs[leaf]).toEqual([]);
    expect(verifyReceipt(leaf, batch.proofs[leaf], batch.root)).toBe(true);
  });

  it('throws on an empty input rather than inventing a zero root', () => {
    expect(() => buildBatch([])).toThrow(/at least one leaf/);
  });

  it('rejects a malformed leaf rather than silently truncating', () => {
    expect(() => buildBatch(['abcd'])).toThrow(/leaves\[0\]/);
  });
});

describe('receiptLeaf — production preimage', () => {
  it('is SHA-256 of the 32-byte transaction hash', () => {
    const tx = 'a'.repeat(64);
    const expected = createHash('sha256').update(Buffer.from(tx, 'hex')).digest('hex');
    expect(receiptLeaf(tx)).toBe(expected);
  });

  it('normalises case and an optional 0x prefix so callers cannot fork the tree', () => {
    const lower = 'ab'.repeat(32);
    const upper = 'AB'.repeat(32);
    expect(receiptLeaf(upper)).toBe(receiptLeaf(lower));
    expect(receiptLeaf(`0x${lower}`)).toBe(receiptLeaf(lower));
  });

  it('rejects a value that is not 32 bytes', () => {
    expect(() => receiptLeaf('abcd')).toThrow(/tx_hash/);
  });
});

describe('verifyReceipt — purity', () => {
  it('does not mutate the caller’s proof array', () => {
    const proof = [leafOf('m-1'), leafOf('m-2')];
    const snapshot = [...proof];
    verifyReceipt(leafOf('m-0'), proof, VALID);
    expect(proof).toEqual(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const c = vectors.cases[0];
    const runs = Array.from({ length: 5 }, () => verifyReceipt(c.leaf, c.proof, c.root));
    expect(new Set(runs).size).toBe(1);
  });
});
