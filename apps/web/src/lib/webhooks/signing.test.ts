import { createHash, createPrivateKey, createPublicKey, verify as edVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bodyDigest, signBody } from './signing.ts';
import { WebhookSigningError } from './errors.ts';

const SEED_HEX = 'a'.repeat(64); // 32-byte Ed25519 seed

function publicKeyFor(seedHex: string) {
  const keyBuffer = Buffer.from(seedHex, 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), keyBuffer]),
    format: 'der',
    type: 'pkcs8',
  });
  return createPublicKey(privateKey);
}

describe('signBody', () => {
  it('generates a 128-hex-char signature that verifies against the corresponding public key', () => {
    const body = '{"tx_hash":"aa"}';
    const signature = signBody(body, SEED_HEX);

    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    const ok = edVerify(
      null,
      Buffer.from(body, 'utf8'),
      publicKeyFor(SEED_HEX),
      Buffer.from(signature, 'hex'),
    );
    expect(ok).toBe(true);
  });

  it('verifies an empty body', () => {
    const body = '';
    const signature = signBody(body, SEED_HEX);
    expect(signature).toMatch(/^[0-9a-f]{128}$/);
    const ok = edVerify(
      null,
      Buffer.from(body, 'utf8'),
      publicKeyFor(SEED_HEX),
      Buffer.from(signature, 'hex'),
    );
    expect(ok).toBe(true);
  });

  it('verifies a multi-line JSON payload', () => {
    const body = '{\n  "tx_hash": "aa",\n  "amount": "10"\n}';
    const signature = signBody(body, SEED_HEX);
    const ok = edVerify(
      null,
      Buffer.from(body, 'utf8'),
      publicKeyFor(SEED_HEX),
      Buffer.from(signature, 'hex'),
    );
    expect(ok).toBe(true);
  });

  it('throws WebhookSigningError for a truncated (16-byte) key', () => {
    expect(() => signBody('body', 'aa'.repeat(16))).toThrow(WebhookSigningError);
  });

  it('throws WebhookSigningError for an oversized (64-byte) key', () => {
    expect(() => signBody('body', 'aa'.repeat(64))).toThrow(WebhookSigningError);
  });

  it('throws WebhookSigningError for a malformed non-hex key', () => {
    expect(() => signBody('body', 'not-a-hex-key')).toThrow(WebhookSigningError);
  });

  it('throws WebhookSigningError for an odd-length hex key', () => {
    expect(() => signBody('body', 'abc')).toThrow(WebhookSigningError);
  });
});

describe('bodyDigest', () => {
  it('returns the SHA-256 hex digest for known inputs', () => {
    expect(bodyDigest('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(bodyDigest('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('matches a multi-line JSON body', () => {
    const body = '{\n  "tx_hash": "aa"\n}';
    expect(bodyDigest(body)).toBe(createHash('sha256').update(body).digest('hex'));
  });
});
