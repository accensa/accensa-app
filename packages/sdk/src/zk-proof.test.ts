import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  commitmentOf,
  createCommitment,
  createOpeningProof,
  verifyOpeningProof,
  sha256Hex,
  ZK_PROOF_SCHEME,
} from './zk-proof';

const PAYLOAD = { amount: '1000', route: '/api/data', meta: { region: 'eu', tier: 3 } };

describe('canonicalJson', () => {
  it('serializes deterministically regardless of key order', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJson({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });
});

describe('createCommitment / commitmentOf', () => {
  it('is deterministic under the same payload and blinding', async () => {
    const blinding = '00'.repeat(32);
    const first = await commitmentOf(PAYLOAD, blinding);
    const second = await commitmentOf(PAYLOAD, blinding);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is hiding: the same payload commits differently with fresh blinding', async () => {
    const a = await createCommitment(PAYLOAD);
    const b = await createCommitment(PAYLOAD);
    expect(a.commitment).not.toBe(b.commitment);
    expect(a.blinding).not.toBe(b.blinding);
    expect(a.blinding).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is binding: a different payload never opens to the same commitment', async () => {
    const blinding = '11'.repeat(32);
    const c = await commitmentOf(PAYLOAD, blinding);
    const other = await commitmentOf({ ...PAYLOAD, amount: '2000' }, blinding);
    expect(c).not.toBe(other);
  });
});

describe('verifyOpeningProof', () => {
  it('accepts a genuine opening', async () => {
    const { commitment, blinding } = await createCommitment(PAYLOAD);
    const proof = await createOpeningProof(PAYLOAD, blinding);
    expect(await verifyOpeningProof(commitment, proof)).toBe(true);
  });

  it('accepts a proof built without an explicit blinding (commit+open in one step)', async () => {
    const proof = await createOpeningProof(PAYLOAD);
    const commitment = await commitmentOf(PAYLOAD, proof.blinding);
    expect(await verifyOpeningProof(commitment, proof)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const { commitment, blinding } = await createCommitment(PAYLOAD);
    const proof = await createOpeningProof({ ...PAYLOAD, amount: '9999' }, blinding);
    expect(await verifyOpeningProof(commitment, proof)).toBe(false);
  });

  it('rejects a wrong blinding even for the right payload', async () => {
    const { commitment } = await createCommitment(PAYLOAD);
    const proof = await createOpeningProof(PAYLOAD, 'ff'.repeat(32));
    expect(await verifyOpeningProof(commitment, proof)).toBe(false);
  });

  it('rejects mismatched schemes, missing fields, and malformed commitments', async () => {
    const { commitment, blinding } = await createCommitment(PAYLOAD);
    const proof = await createOpeningProof(PAYLOAD, blinding);

    expect(await verifyOpeningProof(commitment, { ...proof, scheme: 'snarkjs-groth16' })).toBe(
      false,
    );
    expect(await verifyOpeningProof(commitment, { ...proof, blinding: '' })).toBe(false);
    expect(await verifyOpeningProof('', proof)).toBe(false);
    expect(await verifyOpeningProof('not-hex', proof)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('produces the SHA-256 digest of its input', async () => {
    // sha256("abc") — the NIST test vector.
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('round-trips through the canonical payload hash the indexer stores', async () => {
    const hash = await sha256Hex(canonicalJson(PAYLOAD));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await sha256Hex(canonicalJson({ meta: { tier: 3, region: 'eu' }, route: '/api/data', amount: '1000' })));
  });
});

describe('ZK_PROOF_SCHEME', () => {
  it('is the scheme identifier the sync API checks', () => {
    expect(ZK_PROOF_SCHEME).toBe('sha256-commitment-opening');
  });
});
