import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  verifyOutboundWebhookDelivery,
  signWebhookSignature,
  generateWebhookSecret,
  WEBHOOK_SIGNATURE_HEADER,
} from './webhook-verification';

describe('Webhook Verification', () => {
  const secret = 'test_secret_1234567890abcdef1234567890abcdef';
  const body = '{"event":"payment.completed","amount":100}';

  it('generates a valid webhook secret', () => {
    const generated = generateWebhookSecret();
    expect(typeof generated).toBe('string');
    expect(generated.length).toBe(64);
  });

  it('signs and verifies webhook signatures correctly with raw body', () => {
    const signature = signWebhookSignature(body, secret);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects invalid signatures or wrong secrets with raw body', () => {
    const signature = signWebhookSignature(body, secret);
    expect(verifyWebhookSignature(body, '0'.repeat(64), secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature, 'wrong_secret')).toBe(false);
    expect(verifyWebhookSignature(body, 'not-a-hex-signature', secret)).toBe(false);
  });

  it('handles Request objects correctly', async () => {
    const signature = signWebhookSignature(body, secret);
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body,
    });

    const isValid = await verifyWebhookSignature(req, secret);
    expect(isValid).toBe(true);
  });

  it('rejects Request objects with missing or invalid secret/signature', async () => {
    const reqMissingSig = new Request('https://example.com/webhook', {
      method: 'POST',
      body,
    });
    expect(await verifyWebhookSignature(reqMissingSig, secret)).toBe(false);
    expect(await verifyWebhookSignature(reqMissingSig, '')).toBe(false);

    const signature = signWebhookSignature(body, secret);
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body,
    });
    expect(await verifyWebhookSignature(req, '')).toBe(false);
  });

  it('supports verifyOutboundWebhookDelivery helper', () => {
    const signature = signWebhookSignature(body, secret);
    expect(verifyOutboundWebhookDelivery(body, signature, secret)).toBe(true);
  });
});


