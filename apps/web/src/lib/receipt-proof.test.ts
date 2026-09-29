import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAudit, parseReceiptJson, verifyPartySignature } from './receipt-proof';

const H = (c: string) => c.repeat(64);
const valid = { batchId: 1, leaf: H('a'), proof: [H('b'), H('c')] };

function keyed(leaf: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const signature = sign(null, Buffer.from(leaf, 'hex'), privateKey).toString('hex');
  return { publicKey: raw, signature };
}

describe('parseReceiptJson', () => {
  it('parses a minimal receipt and normalises hex', () => {
    const r = parseReceiptJson(JSON.stringify({ ...valid, leaf: `0x${H('A')}`, batchId: '7' }));
    expect(r).toMatchObject({
      ok: true,
      receipt: { batchId: 7, leaf: H('a'), proof: [H('b'), H('c')] },
    });
  });

  it.each([
    ['not json', '{nope', /not valid JSON/],
    ['an array', '[]', /JSON object/],
    ['a zero batch id', JSON.stringify({ ...valid, batchId: 0 }), /batchId/],
    ['a short leaf', JSON.stringify({ ...valid, leaf: 'abcd' }), /leaf/],
    ['an empty proof', JSON.stringify({ ...valid, proof: [] }), /proof/],
    ['a bad proof entry', JSON.stringify({ ...valid, proof: [H('b'), 'zz'] }), /proof\[1\]/],
    [
      'a short signature',
      JSON.stringify({
        ...valid,
        signatures: { merchant: { publicKey: H('a'), signature: 'ab' } },
      }),
      /signature must be a 64-byte/,
    ],
  ])('rejects %s', (_name, text, message) => {
    const r = parseReceiptJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('rejects oversized input', () => {
    expect(parseReceiptJson(' '.repeat(300 * 1024))).toMatchObject({ ok: false });
  });
});

describe('verifyPartySignature', () => {
  const leaf = H('a');

  it('accepts a genuine signature', async () => {
    expect(await verifyPartySignature(leaf, keyed(leaf))).toBe('valid');
  });

  it('flags a signature over a different (tampered) leaf', async () => {
    expect(await verifyPartySignature(H('b'), keyed(leaf))).toBe('invalid');
  });

  it('flags a signature from another key', async () => {
    const a = keyed(leaf);
    const b = keyed(leaf);
    expect(
      await verifyPartySignature(leaf, { publicKey: b.publicKey, signature: a.signature }),
    ).toBe('invalid');
  });

  it('reports a missing party', async () => {
    expect(await verifyPartySignature(leaf, undefined)).toBe('missing');
  });
});

describe('buildAudit', () => {
  const ok = { local: true, onchain: true };

  it('verifies when both Merkle checks pass and signatures are valid or absent', () => {
    expect(buildAudit(ok, 'valid', 'missing').verified).toBe(true);
  });

  it('rejects a forged receipt whose proof fails', () => {
    expect(buildAudit({ local: false, onchain: false }, 'valid', 'valid').verified).toBe(false);
  });

  it('rejects when the ledger and local check disagree', () => {
    expect(buildAudit({ local: true, onchain: false }, 'valid', 'valid').verified).toBe(false);
  });

  it('rejects a tampered signature even if the proof holds', () => {
    expect(buildAudit(ok, 'invalid', 'valid').verified).toBe(false);
    expect(buildAudit(ok, 'valid', 'unsupported').verified).toBe(false);
  });

  it('does not verify when a check could not run', () => {
    expect(buildAudit({ local: true, onchain: null }, 'valid', 'valid').verified).toBe(false);
  });
});
