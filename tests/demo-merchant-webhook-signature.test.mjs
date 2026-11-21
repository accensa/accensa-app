import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyWebhookSignature } from '../apps/demo-merchant/lib/webhook-signature.js';

const SECRET = 'test-secret-key';

function sign(body, secret) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

await test('verifyWebhookSignature — raw-bytes verification', async (t) => {
  await t.test('accepts a valid signature computed over the raw bytes', () => {
    const rawBody = Buffer.from('{"tx_hash":"abc"}');
    const sig = sign(rawBody, SECRET);
    assert.equal(verifyWebhookSignature(rawBody, sig, SECRET), true);
  });

  await t.test('rejects signature computed over re-serialized JSON (old bug)', () => {
    // The original wire bytes include extra whitespace that JSON.stringify drops
    const originalBytes = Buffer.from('{ "event": "payment", "extra": 1 }');
    const reserialized = JSON.stringify(JSON.parse(originalBytes.toString()));
    if (originalBytes.toString() !== reserialized) {
      const wrongSig = sign(reserialized, SECRET);
      assert.equal(
        verifyWebhookSignature(originalBytes, wrongSig, SECRET),
        false,
        'signature over re-serialized form must not verify raw bytes',
      );
    }
  });
});

await test('verifyWebhookSignature — unset secret (permissive mode)', async (t) => {
  await t.test('returns true when webhookSecret is undefined', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), 'anysig', undefined), true);
  });

  await t.test('returns true when webhookSecret is empty string', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), 'anysig', ''), true);
  });
});

await test('verifyWebhookSignature — missing header', async (t) => {
  await t.test('returns false when signatureHeader is undefined', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), undefined, SECRET), false);
  });

  await t.test('returns false when signatureHeader is empty string', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), '', SECRET), false);
  });
});

await test('verifyWebhookSignature — missing rawBody', async (t) => {
  await t.test('returns false when rawBody is undefined and secret is set', () => {
    const sig = sign('body', SECRET);
    assert.equal(verifyWebhookSignature(undefined, sig, SECRET), false);
  });
});

await test('verifyWebhookSignature — malformed hex', async (t) => {
  await t.test('returns false when signatureHeader contains non-hex characters', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), 'not-valid-hex!!', SECRET), false);
  });

  await t.test('returns false when signatureHeader is correct hex of wrong length', () => {
    assert.equal(verifyWebhookSignature(Buffer.from('body'), 'deadbeef', SECRET), false);
  });
});

await test('verifyWebhookSignature — valid signature', async (t) => {
  await t.test('accepts a string body', () => {
    const body = '{"event":"payment"}';
    const sig = sign(body, SECRET);
    assert.equal(verifyWebhookSignature(body, sig, SECRET), true);
  });

  await t.test('rejects a correct signature with a wrong secret', () => {
    const body = Buffer.from('{"event":"payment"}');
    const sig = sign(body, SECRET);
    assert.equal(verifyWebhookSignature(body, sig, 'wrong-secret'), false);
  });

  await t.test('rejects a tampered body', () => {
    const body = Buffer.from('{"event":"payment"}');
    const sig = sign(body, SECRET);
    const tampered = Buffer.from('{"event":"TAMPERED"}');
    assert.equal(verifyWebhookSignature(tampered, sig, SECRET), false);
  });
});
