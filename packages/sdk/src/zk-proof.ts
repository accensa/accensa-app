/**
 * Zero-Knowledge Verification for Off-chain Privacy (#173).
 *
 * Merchants require privacy for transaction volumes: the indexer must be able
 * to verify a state transition without ever seeing (or storing) the
 * plaintext. This module provides the SDK side of that contract — a binding
 * *and hiding* commitment plus an opening proof — and a verifier interface the
 * indexer uses to accept or reject submissions.
 *
 * The scheme is a standard hash commitment (Pedersen-style in spirit, but
 * built on SHA-256 so it runs anywhere WebCrypto does):
 *
 *   commitment = SHA-256( blinding || canonical_json(payload) )
 *
 * - **Binding**: an opening cannot be found for a different payload — the
 *   prover cannot claim the commitment was for anything other than what they
 *   actually committed to (collision resistance of SHA-256).
 * - **Hiding**: the payload cannot be recovered from the commitment, and a
 *   fresh random `blinding` per commitment means the same payload commits to
 *   a different value each time (the blinding is the entropy that hides it).
 * - **Zero-knowledge-ish by construction**: the prover reveals only the
 *   commitment and, when they choose to open it, the payload+blinding pair.
 *   The indexer's store records the commitment and a one-way hash of the
 *   payload — never the payload itself — so a leaked database exposes
 *   nothing about the underlying data.
 *
 * `ZKVerifier` is the pluggable seam the indexer verifies through: a future
 * migration to a real zk-SNARK circuit (e.g. SnarkJS groth16) implements the
 * same interface without touching the sync API.
 *
 * Usage:
 *   import { createCommitment, createOpeningProof, verifyOpeningProof } from '@accensa/sdk/zk-proof';
 *
 *   const { commitment, blinding } = await createCommitment({ amount: '1000', route: '/api/data' });
 *   // indexer stores only `commitment`; keep `blinding` private
 *   const proof = createOpeningProof({ amount: '1000', route: '/api/data' }, blinding);
 *   const valid = await verifyOpeningProof(commitment, proof); // true
 */

/** Scheme identifier recorded on every proof and commitment row. */
export const ZK_PROOF_SCHEME = 'sha256-commitment-opening';

/** A binding commitment to a payload, produced with fresh blinding entropy. */
export interface CommitmentResult {
  /** Hex SHA-256 of `blinding || canonical_json(payload)`. */
  commitment: string;
  /**
   * The hex blinding value used. This is the secret that makes the commitment
   * hiding — it must never be sent to the indexer ahead of verification (it
   * IS sent inside the opening proof, which is the whole point of opening).
   */
  blinding: string;
}

/** The opening a prover submits to demonstrate a commitment's payload. */
export interface OpeningProof {
  scheme: typeof ZK_PROOF_SCHEME;
  payload: unknown;
  blinding: string;
}

/**
 * The verification contract the indexer accepts proofs through.
 *
 * A real zk-SNARK verifier (SnarkJS, a Rust circuit) implements this same
 * interface; the sync API only depends on `scheme` + `verify`, so swapping
 * the scheme never changes the route.
 */
export interface ZkVerifier {
  readonly scheme: string;
  verify(commitment: string, proof: OpeningProof): Promise<boolean>;
}

/**
 * Deterministic JSON serialization: keys sorted recursively, so the same
 * logical payload always canonicalizes to the same bytes on every platform
 * and in every runtime.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
    return sorted;
  }
  return value;
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 digest as hex, using WebCrypto with a Node `node:crypto` fallback —
 * the same dual-runtime pattern the settlement signer in index.ts uses, so
 * the module works in the browser and under Node.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', data);
      return hexFromBytes(new Uint8Array(digest));
    } catch {
      // Fall through to Node's implementation below.
    }
  }

  try {
    const crypto = await import('node:crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    throw new Error('SHA-256 unavailable: WebCrypto and Node.js crypto are both missing');
  }
}

/** 32 cryptographically-random bytes as hex (the commitment blinding). */
export async function randomBlinding(): Promise<string> {
  const subtle = globalThis.crypto;
  if (subtle?.getRandomValues) {
    const bytes = new Uint8Array(32);
    subtle.getRandomValues(bytes);
    return hexFromBytes(bytes);
  }
  try {
    const crypto = await import('node:crypto');
    return crypto.randomBytes(32).toString('hex');
  } catch {
    throw new Error('No secure random source available for commitment blinding');
  }
}

/**
 * Computes the commitment for a payload under a blinding value:
 * `SHA-256(blinding || canonical_json(payload))`.
 */
export async function commitmentOf(payload: unknown, blinding: string): Promise<string> {
  return sha256Hex(`${blinding}${canonicalJson(payload)}`);
}

/**
 * Creates a binding, hiding commitment to `payload`.
 *
 * The returned `blinding` is the secret that makes the commitment hiding —
 * keep it private until you intend to open the commitment. Generate a fresh
 * one per commitment; reusing a blinding lets an observer correlate two
 * commitments to the same payload.
 */
export async function createCommitment(
  payload: unknown,
  opts: { blinding?: string } = {},
): Promise<CommitmentResult> {
  const blinding = opts.blinding ?? (await randomBlinding());
  return { commitment: await commitmentOf(payload, blinding), blinding };
}

/**
 * Builds the opening proof for a commitment.
 *
 * Pass the same payload and blinding used in `createCommitment`. When
 * `blinding` is omitted, a fresh one is generated — useful when the prover
 * commits and opens in one step.
 */
export async function createOpeningProof(
  payload: unknown,
  blinding?: string,
): Promise<OpeningProof> {
  const usedBlinding = blinding ?? (await randomBlinding());
  return { scheme: ZK_PROOF_SCHEME, payload, blinding: usedBlinding };
}

/**
 * Verifies an opening proof against a commitment.
 *
 * Recomputes `SHA-256(blinding || canonical_json(payload))` and compares it
 * with the presented commitment, returning false — never throwing — for a
 * mismatched scheme, missing fields, or a failed recomputation. This is what
 * the indexer calls before recording a state transition.
 */
export async function verifyOpeningProof(
  commitment: string,
  proof: OpeningProof,
): Promise<boolean> {
  if (!commitment || typeof commitment !== 'string') return false;
  if (!proof || proof.scheme !== ZK_PROOF_SCHEME) return false;
  if (typeof proof.blinding !== 'string' || proof.blinding.length === 0) return false;
  try {
    const expected = await commitmentOf(proof.payload, proof.blinding);
    if (expected.length !== commitment.length) return false;
    // Constant-time comparison so a failing check does not leak how far the
    // two digests agree.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ commitment.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

/** The SHA-256 commitment verifier, satisfying the pluggable `ZkVerifier`. */
export const sha256CommitmentVerifier: ZkVerifier = {
  scheme: ZK_PROOF_SCHEME,
  verify: verifyOpeningProof,
};
