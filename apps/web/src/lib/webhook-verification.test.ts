import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookSignature, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, verifyOutboundWebhookDelivery } from './webhook-verification';

const SECRET = 'test-secret';
const BODY = JSON.stringify({ event: 'payment.settled', tx_hash: 'a'.repeat(64) });

signWebhookSignature;

describe('webhook-verification', () => {
  it('accepts a valid signed body', () => {
    const sig = signWebhookSignature(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signWebhookSignature(BODY, SECRET);
    expect(verifyWebhookSignature(BODY + 'tamper', sig, SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
  });

  it('wires correctly to outbound delivery check', () => {
    const sig = signWebhookSignature(BODY, SECRET);
    expect(verifyOutboundWebhookDelivery(BODY, sig, SECRET)).toBe(true);
  });

  it('exposes WEBHOOK_SIGNATURE_HEADER', () => {
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('x-webhook-signature');
  });
});
