import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookSignature, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from './webhooks';

const SECRET = 'shared-secret-value';
const BODY = JSON.stringify({ tx_hash: 'a'.repeat(64), route: '/api/hello', method: 'GET' });

describe('signWebhookSignature', () => {
  it('produces a hex HMAC-SHA256 digest of the raw payload', () => {
    const signature = signWebhookSignature(BODY, SECRET);
    expect(signature).toBe(createHmac('sha256', SECRET).update(BODY).digest('hex'));
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the digest the indexer itself computes', () => {
    // The web app signs outbound webhooks with exactly
    // createHmac('sha256', secret).update(body).digest('hex') — a merchant
    // verifying with this module must accept that value verbatim.
    const indexerDigest = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(signWebhookSignature(BODY, SECRET)).toBe(indexerDigest);
  });

  it('differs across secrets and across payloads', () => {
    const withOtherSecret = signWebhookSignature(BODY, 'other-secret');
    const withOtherBody = signWebhookSignature('{"route":"/api/free"}', SECRET);
    expect(withOtherSecret).not.toBe(signWebhookSignature(BODY, SECRET));
    expect(withOtherBody).not.toBe(signWebhookSignature(BODY, SECRET));
  });

  it('signs a Buffer payload byte-for-byte', () => {
    const buffer = Buffer.from(BODY, 'utf8');
    expect(signWebhookSignature(buffer, SECRET)).toBe(signWebhookSignature(BODY, SECRET));
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a genuine signature', () => {
    const signature = signWebhookSignature(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signature = signWebhookSignature(BODY, SECRET);
    const tampered = BODY.replace('/api/hello', '/api/analytics/report');
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a signature minted with a different secret', () => {
    const signature = signWebhookSignature(BODY, 'someone-elses-secret');
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(false);
  });

  it('rejects a signature for a different body even when the secret matches', () => {
    const signature = signWebhookSignature('{"route":"/api/free"}', SECRET);
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(false);
  });

  it('rejects a missing, empty, or non-string signature', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, '   ', SECRET)).toBe(false);
  });

  it('rejects a malformed (non-hex) signature rather than throwing', () => {
    expect(verifyWebhookSignature(BODY, 'not-hex-at-all', SECRET)).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    // A genuine 64-char digest truncated to 32 chars must fail on length
    // before any byte comparison.
    const signature = signWebhookSignature(BODY, SECRET).slice(0, 32);
    expect(verifyWebhookSignature(BODY, signature, SECRET)).toBe(false);
  });

  it('exposes the wire header name', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('x-webhook-signature');
  });
});
