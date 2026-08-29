import { createHash } from 'node:crypto';

/**
 * Verifies a payment receipt against an anchored batch root, off-chain.
 *
 * Mirrors `ReceiptAnchor.verify_receipt` exactly: proof siblings are combined
 * with sorted-pair SHA-256 hashing (lexicographically smaller hash first), so
 * proofs carry no left/right position flags. Both implementations are pinned to
 * the shared conformance fixture in `merkle-vectors.json`.
 *
 * @param leaf  hex-encoded 32-byte hash of the receipt (payment hash + metadata)
 * @param proof hex-encoded 32-byte sibling hashes, leaf-to-root order
 * @param root  hex-encoded 32-byte Merkle root anchored on-chain
 * @throws if any input is not a hex-encoded 32-byte value
 */
export function verifyReceipt(leaf: string, proof: string[], root: string): boolean {
  let computed = decodeHash(leaf, 'leaf');

  for (const siblingHex of proof) {
    const sibling = decodeHash(siblingHex, 'proof entries');
    const [lo, hi] =
      Buffer.compare(computed, sibling) <= 0 ? [computed, sibling] : [sibling, computed];
    computed = createHash('sha256')
      .update(Buffer.concat([lo, hi]))
      .digest();
  }

  return computed.equals(decodeHash(root, 'root'));
}

/**
 * Decodes a hex-encoded 32-byte hash.
 *
 * `Buffer.from(hex, 'hex')` stops at the first invalid character rather than
 * throwing, so a malformed value would otherwise be silently truncated and
 * compared as a shorter buffer.
 */
function decodeHash(value: string, label: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a hex-encoded 32-byte hash`);
  }
  return Buffer.from(value, 'hex');
}

export interface BatchInfo {
  root: string;
  leaves: string[];
  proofs: Record<string, string[]>;
}

/** Combine two nodes smaller-hash-first, so proofs need no position flags. */
function combine(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return createHash('sha256')
    .update(Buffer.concat([lo, hi]))
    .digest();
}

/**
 * Builds every level of the tree. An odd node at the end of a level is promoted
 * unchanged to the next level rather than duplicated — the same convention as
 * `packages/sdk/scripts/generate-vectors.mjs` and `ReceiptAnchor::verify_receipt`.
 */
function buildLevels(leaves: Buffer[]): Buffer[][] {
  const levels: Buffer[][] = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? combine(level[i], level[i + 1]) : level[i]);
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function proofFor(levels: Buffer[][], index: number): Buffer[] {
  const proof: Buffer[] = [];
  let i = index;
  for (let l = 0; l < levels.length - 1; l++) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < levels[l].length) proof.push(levels[l][sibling]);
    i = Math.floor(i / 2);
  }
  return proof;
}

/**
 * Builds a Merkle batch and a membership proof for every leaf.
 *
 * The tree is the production implementation of the convention pinned by
 * `merkle-vectors.json`: sorted-pair SHA-256, odd nodes promoted unchanged,
 * proofs in leaf-to-root order. `verifyReceipt` (and on-chain
 * `verify_receipt`) will accept every proof this returns.
 *
 * Leaf order is significant — it is the order the caller supplies. The
 * anchoring flow feeds payments ordered by ledger, then `tx_hash`, so the
 * same selection always produces the same root.
 *
 * @throws if `leaves` is empty, or if any value is not a hex-encoded 32-byte hash
 */
export function buildBatch(leaves: string[]): BatchInfo {
  if (leaves.length === 0) {
    throw new Error('buildBatch requires at least one leaf');
  }

  const normalised = leaves.map((leaf, i) => {
    const hex = leaf.trim().toLowerCase();
    decodeHash(hex, `leaves[${i}]`);
    return hex;
  });

  const buffers = normalised.map((hex) => Buffer.from(hex, 'hex'));
  const levels = buildLevels(buffers);
  const root = levels[levels.length - 1][0].toString('hex');

  const proofs: Record<string, string[]> = {};
  for (let i = 0; i < normalised.length; i++) {
    proofs[normalised[i]] = proofFor(levels, i).map((b) => b.toString('hex'));
  }

  return { root, leaves: normalised, proofs };
}

/**
 * Production receipt leaf: SHA-256 of the 32-byte Stellar transaction hash.
 *
 * This is the contract between the anchoring flow, `@accensa/sdk`, and anyone
 * verifying a receipt. A third party who knows only the payment's `tx_hash`
 * can recompute the leaf, fetch the proof, and check it against the anchored
 * root — locally via {@link verifyReceipt} or on-chain via `verify_receipt`.
 *
 * The shared conformance vectors in `merkle-vectors.json` pin the *tree*
 * algorithm (sorted-pair SHA-256), not the leaf preimage. Those fixtures hash
 * UTF-8 labels so the SDK and the Soroban tests can agree without depending
 * on a live ledger. Production leaves are always `receiptLeaf(tx_hash)`.
 *
 * @param txHash hex-encoded 32-byte Stellar transaction hash
 * @throws if `txHash` is not a hex-encoded 32-byte value
 */
export function receiptLeaf(txHash: string): string {
  const hex = txHash.trim().replace(/^0x/i, '').toLowerCase();
  const bytes = decodeHash(hex, 'tx_hash');
  return createHash('sha256').update(bytes).digest('hex');
}
