import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  verifyOutboundWebhookDelivery,
  signWebhookSignature,
  generateWebhookSecret,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
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

describe('Webhook timestamp replay protection', () => {
  const secret = 'test_secret_1234567890abcdef1234567890abcdef';
  const body = '{"event":"payment.completed","amount":100}';
  const now = () => Math.floor(Date.now() / 1000);

  function timestampedRequest(timestamp: number | string, signature: string) {
    return new Request('https://example.com/webhook', {
      method: 'POST',
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
      },
      body,
    });
  }

  it('exports the header name and the default tolerance', () => {
    expect(WEBHOOK_TIMESTAMP_HEADER).toBe('x-webhook-timestamp');
    expect(DEFAULT_WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });

  it('accepts a Request whose signature binds a current timestamp', async () => {
    const timestamp = now();
    const req = timestampedRequest(timestamp, signWebhookSignature(body, secret, timestamp));

    expect(await verifyWebhookSignature(req, secret)).toBe(true);
  });

  it('accepts a timestamp supplied by the caller instead of a header', () => {
    const timestamp = now();
    const signature = signWebhookSignature(body, secret, timestamp);

    expect(verifyWebhookSignature(body, signature, secret, { timestamp })).toBe(true);
    expect(verifyWebhookSignature(body, signature, secret, timestamp)).toBe(true);
  });

  it('rejects an expired timestamp', async () => {
    const timestamp = now() - DEFAULT_WEBHOOK_TOLERANCE_SECONDS - 1;
    const signature = signWebhookSignature(body, secret, timestamp);

    expect(await verifyWebhookSignature(timestampedRequest(timestamp, signature), secret)).toBe(
      false,
    );
    expect(verifyWebhookSignature(body, signature, secret, { timestamp })).toBe(false);
  });

  it('rejects a future timestamp', async () => {
    const timestamp = now() + 60;
    const signature = signWebhookSignature(body, secret, timestamp);

    expect(await verifyWebhookSignature(timestampedRequest(timestamp, signature), secret)).toBe(
      false,
    );
    expect(verifyWebhookSignature(body, signature, secret, { timestamp })).toBe(false);
  });

  it('rejects a replayed signature when the timestamp header is changed', async () => {
    const original = now();
    const signature = signWebhookSignature(body, secret, original);

    expect(await verifyWebhookSignature(timestampedRequest(original + 1, signature), secret)).toBe(
      false,
    );
  });

  it('rejects malformed timestamps and bad tolerance values', () => {
    const signature = signWebhookSignature(body, secret, now());

    expect(verifyWebhookSignature(body, signature, secret, { timestamp: 'not-a-time' })).toBe(
      false,
    );
    expect(
      verifyWebhookSignature(body, signature, secret, { timestamp: now(), tolerance: -1 }),
    ).toBe(false);
  });

  it('honours a custom tolerance window', () => {
    const timestamp = now() - 30;
    const signature = signWebhookSignature(body, secret, timestamp);

    expect(verifyWebhookSignature(body, signature, secret, { timestamp, tolerance: 60 })).toBe(
      true,
    );
    expect(verifyWebhookSignature(body, signature, secret, { timestamp, tolerance: 10 })).toBe(
      false,
    );
  });

  it('keeps verifying signatures without a timestamp header', async () => {
    const signature = signWebhookSignature(body, secret);
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      headers: { [WEBHOOK_SIGNATURE_HEADER]: signature },
      body,
    });

    expect(await verifyWebhookSignature(req, secret)).toBe(true);
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });
});
