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
    computed = createHash('sha256').update(Buffer.concat([lo, hi])).digest();
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
