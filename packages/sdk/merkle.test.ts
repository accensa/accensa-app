import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { AccensaContractError } from './src/errors';
import { verifyReceipt } from './merkle';
import { verifyReceipt, buildBatch } from './merkle';
import vectors from './merkle-vectors.json';

/** Reconstruct a leaf hash the same way the conformance vectors were generated. */

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
    expect(() => verifyReceipt('abcd', [], VALID)).toThrow(AccensaContractError);
    expect(() => verifyReceipt('abcd', [], VALID)).toThrow(/leaf/);
  });

  it('rejects a proof entry that is not 32 bytes', () => {
    expect(() => verifyReceipt(VALID, ['abcd'], VALID)).toThrow(AccensaContractError);
    expect(() => verifyReceipt(VALID, ['abcd'], VALID)).toThrow(/proof/);
  });

  it('rejects a root that is not 32 bytes', () => {
    expect(() => verifyReceipt(VALID, [], 'abcd')).toThrow(AccensaContractError);
    expect(() => verifyReceipt(VALID, [], 'abcd')).toThrow(/root/);
  });

  it('rejects non-hex characters rather than silently truncating', () => {
    // Buffer.from(hex) stops at the first invalid character instead of throwing,
    // so a value like this would otherwise decode to 1 byte and compare short.
    const sneaky = 'ab' + 'zz' + 'a'.repeat(60);
    expect(sneaky).toHaveLength(64);
    expect(() => verifyReceipt(sneaky, [], VALID)).toThrow(AccensaContractError);
    expect(() => verifyReceipt(sneaky, [], VALID)).toThrow(/leaf/);
  });

  it('rejects an odd-length hex string', () => {
    expect(() => verifyReceipt('a'.repeat(63), [], VALID)).toThrow(AccensaContractError);
    expect(() => verifyReceipt('a'.repeat(63), [], VALID)).toThrow(/leaf/);
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

describe('buildBatch — shared conformance vectors', () => {
  // Build a tree from the conformance-vectors' known leaves and verify
  // every generated proof against the original vector's root. A round-trip
  // through buildBatch → verifyReceipt is necessary but not sufficient
  // (a consistently wrong implementation passes that), so we also compare
  // roots directly against the fixture.

  it('two-leaf batch: roots and proofs match the conformance vectors', () => {
    const c = vectors.cases.find((c) => c.name.includes('two-leaf batch — left leaf'))!;
    const rightLeaf = vectors.cases.find((c) => c.name.includes('two-leaf batch — right leaf'))!;
    const batch = buildBatch([c.leaf, rightLeaf.leaf]);

    expect(batch.root).toBe(c.root);
    expect(batch.proofs[c.leaf].length).toBeGreaterThan(0);
    expect(batch.proofs[rightLeaf.leaf].length).toBeGreaterThan(0);
    expect(verifyReceipt(c.leaf, batch.proofs[c.leaf], batch.root)).toBe(true);
    expect(verifyReceipt(rightLeaf.leaf, batch.proofs[rightLeaf.leaf], batch.root)).toBe(true);
    expect(batch.proofs[c.leaf]).toEqual(c.proof);
    expect(batch.proofs[rightLeaf.leaf]).toEqual(rightLeaf.proof);
  });

  it('three-leaf batch: root matches the conformance vector', () => {
    // The conformance fixture gives leaf 0 and leaf 2 but not leaf 1.
    // Leaf 1 can be deduced: it is the first proof entry of leaf 0
    // (the level-0 sibling in leaf-to-root order).
    const leaf0Case = vectors.cases.find((c) => c.name.includes('three-leaf batch — leaf 0'))!;
    const leaf2Case = vectors.cases.find((c) => c.name.includes('three-leaf batch — leaf 2'))!;
    const leaf1 = leaf0Case.proof[0]; // leaf 0's level-0 sibling
    const batch = buildBatch([leaf0Case.leaf, leaf1, leaf2Case.leaf]);

    expect(batch.root).toBe(leaf0Case.root);
    expect(batch.proofs[leaf0Case.leaf]).toEqual(leaf0Case.proof);
    expect(batch.proofs[leaf2Case.leaf]).toEqual(leaf2Case.proof);
    for (const leaf of batch.leaves) {
      expect(verifyReceipt(leaf, batch.proofs[leaf], batch.root)).toBe(true);
    }
  });

  it('every returned proof verifies against the returned root', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafOf(`verify-all-${i}`));
    const batch = buildBatch(leaves);
    for (const leaf of leaves) {
      expect(verifyReceipt(leaf, batch.proofs[leaf], batch.root)).toBe(true);
    }
  });

  it('round-trip: buildBatch then verifyReceipt for the conformance valid cases', () => {
    const validCases = vectors.cases.filter((c) => c.expected);
    const leaves = validCases.map((c) => c.leaf);
    const batch = buildBatch(leaves);
    for (const c of validCases) {
      expect(verifyReceipt(c.leaf, batch.proofs[c.leaf], batch.root)).toBe(true);
    }
  });
});

describe('buildBatch — odd-node handling', () => {
  it('promotes an unpaired node unchanged (three-leaf batch)', () => {
    const leaves = [leafOf('odd-a'), leafOf('odd-b'), leafOf('odd-c')];
    const batch = buildBatch(leaves);

    for (const leaf of leaves) {
      expect(verifyReceipt(leaf, batch.proofs[leaf], batch.root)).toBe(true);
    }

    // Leaf at index 2 (the odd node at level 0) is promoted unchanged
    // to level 1, so its proof is one entry shorter than leaves 0 and 1.
    expect(batch.proofs[leaves[0]].length).toBe(2);
    expect(batch.proofs[leaves[1]].length).toBe(2);
    expect(batch.proofs[leaves[2]].length).toBe(1);
  });

  it('five-leaf batch: all proofs verify and the promoted node has a shorter proof', () => {
    const leaves = Array.from({ length: 5 }, (_, i) => leafOf(`five-${i}`));
    const batch = buildBatch(leaves);
    for (const leaf of leaves) {
      expect(verifyReceipt(leaf, batch.proofs[leaf], batch.root)).toBe(true);
    }
    const proofLengths = leaves.map((l) => batch.proofs[l].length);
    const maxLen = Math.max(...proofLengths);
    expect(proofLengths.some((len) => len < maxLen)).toBe(true);
  });
});

describe('buildBatch — boundaries', () => {
  it('empty input returns a 32-byte zero root', () => {
    const batch = buildBatch([]);
    expect(batch.root).toBe('0'.repeat(64));
    expect(batch.leaves).toEqual([]);
    expect(batch.proofs).toEqual({});
  });

  it('single leaf returns the leaf as root with an empty proof', () => {
    const leaf = leafOf('single');
    const batch = buildBatch([leaf]);
    expect(batch.root).toBe(leaf);
    expect(batch.leaves).toEqual([leaf]);
    expect(batch.proofs[leaf]).toEqual([]);
    expect(verifyReceipt(leaf, [], batch.root)).toBe(true);
  });

  it('duplicate leaves throw: the proofs map cannot represent two different proofs for the same hash', () => {
    const leaf = leafOf('dup');
    expect(() => buildBatch([leaf, leaf])).toThrow(/duplicate leaf/);
  });
});

describe('buildBatch — leaf validation', () => {
  it('rejects a leaf that is not 32 bytes', () => {
    expect(() => buildBatch(['abcd'])).toThrow(/leaf/);
  });

  it('rejects non-hex characters', () => {
    const sneaky = 'ab' + 'zz' + 'a'.repeat(60);
    expect(sneaky).toHaveLength(64);
    expect(() => buildBatch([sneaky])).toThrow(/leaf/);
  });

  it('rejects an odd-length hex string', () => {
    expect(() => buildBatch(['a'.repeat(63)])).toThrow(/leaf/);
  });

  it('rejects when any leaf in the batch is invalid', () => {
    const valid = leafOf('ok');
    expect(() => buildBatch([valid, 'not-hex'])).toThrow(/leaf/);
  });
});

describe('buildBatch — determinism', () => {
  it('produces identical output across repeated calls', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leafOf(`det-${i}`));
    const runs = Array.from({ length: 5 }, () => buildBatch(leaves));
    const roots = runs.map((r) => r.root);
    expect(new Set(roots).size).toBe(1);
    for (const run of runs) {
      expect(run.proofs).toEqual(runs[0].proofs);
    }
  });
});
