import { createHash } from 'node:crypto';
import { AccensaContractError } from './src/errors';

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
    // A hash that is not hex-encoded 32 bytes violates the receipt format the
    // contract anchors on-chain, so it surfaces as a contract error.
    throw new AccensaContractError(`${label} must be a hex-encoded 32-byte hash`);
  }
  return Buffer.from(value, 'hex');
}

export interface BatchInfo {
  root: string;
  leaves: string[];
  proofs: Record<string, string[]>;
}

/**
 * Builds a Merkle tree from receipt leaves and returns the root together with
 * each leaf's proof.
 *
 * Mirrors `ReceiptAnchor.verify_receipt` exactly: sorted-pair SHA-256 hashing
 * (lexicographically smaller hash first), so proofs carry no left/right position
 * flags. Both implementations are pinned to the shared conformance fixture in
 * `merkle-vectors.json`.
 *
 * Odd-node handling: an unpaired node at the end of a level is promoted
 * unchanged to the next level. This is the deliberate choice documented in
 * `merkle-vectors.json`'s `algorithm.oddNode` field, and it matches the
 * Soroban `ReceiptAnchor` contract's behaviour. A promoted node does not gain
 * any proof entries at that level because it is not hashed.
 *
 * Boundaries:
 *  - Empty input returns a 32-byte zero root (a sentinel — a real batch can
 *    never produce this root because even a single-leaf batch returns the
 *    leaf itself as the root).
 *  - A single leaf returns the leaf as the root with an empty proof.
 *  - Duplicate leaves are rejected: the `proofs` map is keyed by leaf hash,
 *    so two leaves with the same hash would collide. In practice every receipt
 *    hash includes unique payment metadata, so duplicates do not arise.
 *
 * Leaves are validated through the existing `decodeHash`, which rejects any
 * value that is not a hex-encoded 32-byte hash.
 *
 * @param leaves  hex-encoded 32-byte hashes of receipts
 * @returns       the root, the leaves (passed through), and a proof per leaf
 * @throws if any leaf is not a valid hex hash, or if leaves contain duplicates
 */
export function buildBatch(leaves: string[]): BatchInfo {
  if (leaves.length === 0) {
    return { root: Buffer.alloc(32).toString('hex'), leaves: [], proofs: {} };
  }

  // Validate all leaves upfront through decodeHash. This rejects malformed
  // input early rather than letting it silently corrupt the tree.
  const buffers = leaves.map((l) => decodeHash(l, 'leaf'));

  // Reject duplicate leaves: the `proofs` map is keyed by leaf hash, so two
  // leaves with the same hash would share a proof entry even though their
  // positions in the tree are different. In practice every receipt hash
  // includes unique payment metadata, so this never arises.
  const seen = new Set<string>();
  for (const l of leaves) {
    if (seen.has(l)) {
      throw new Error(`duplicate leaf hash: ${l}`);
    }
    seen.add(l);
  }

  // Track each node's original indices so that proof entries can be
  // accumulated correctly through promoted (unpaired) nodes. When two nodes
  // are paired, all leaf indices behind each node record the other node as
  // their sibling at that level. A promoted node carries all its leaf
  // indices forward unchanged.
  const proofsByIndex: string[][] = leaves.map(() => []);

  let currentLevel: { buf: Buffer; indices: number[] }[] = buffers.map((buf, i) => ({
    buf,
    indices: [i],
  }));

  while (currentLevel.length > 1) {
    const nextLevel: { buf: Buffer; indices: number[] }[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 === currentLevel.length) {
        // Odd node: promoted unchanged. No proof entry because the node is
        // not hashed at this level — it simply carries forward.
        nextLevel.push(currentLevel[i]);
      } else {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const [lo, hi] =
          Buffer.compare(left.buf, right.buf) <= 0 ? [left.buf, right.buf] : [right.buf, left.buf];
        const parent = createHash('sha256')
          .update(Buffer.concat([lo, hi]))
          .digest();

        // Every leaf behind the left node records the right node as its
        // sibling at this level, and vice versa.
        for (const idx of left.indices) {
          proofsByIndex[idx].push(right.buf.toString('hex'));
        }
        for (const idx of right.indices) {
          proofsByIndex[idx].push(left.buf.toString('hex'));
        }

        // The parent inherits all leaf indices from both children.
        nextLevel.push({
          buf: parent,
          indices: [...left.indices, ...right.indices],
        });
      }
    }

    currentLevel = nextLevel;
  }

  // Convert the index-keyed proofs to the leaf-keyed Record the interface
  // requires. Since we rejected duplicates above, each leaf string maps to
  // exactly one index.
  const proofs: Record<string, string[]> = {};
  for (let i = 0; i < leaves.length; i++) {
    proofs[leaves[i]] = proofsByIndex[i];
  }

  return {
    root: currentLevel[0].buf.toString('hex'),
    leaves,
    proofs,
  };
}
