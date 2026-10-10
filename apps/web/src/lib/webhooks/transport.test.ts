import { describe, it, expect, vi } from 'vitest';
import { attemptDelivery } from './transport.ts';

const KEY_32_BYTES = '11'.repeat(32);

const base = {
  id: '7',
  url: 'https://merchant.example/hook',
  body: '{"tx_hash":"aa"}',
  signingKey: KEY_32_BYTES,
};

describe('attemptDelivery — the extracted HTTP edge of deliverDue (#350)', () => {
  it('reports a 2xx attempt as a plain status outcome', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const outcome = await attemptDelivery({ ...base, fetchImpl, timeoutMs: 1_000 });

    expect(outcome).toMatchObject({
      statusCode: 204,
      error: null,
      retryAfter: null,
      transportError: false,
    });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-Signature']).toMatch(/^[0-9a-f]{128}$/);
    expect((init?.headers as Record<string, string>)['X-Accensa-Delivery-Id']).toBe('7');
  });

  it('surfaces a 5xx status and its Retry-After without calling it transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 503, headers: { 'retry-after': '12' } }),
    );
    const outcome = await attemptDelivery({ ...base, fetchImpl, timeoutMs: 1_000 });

    expect(outcome.statusCode).toBe(503);
    expect(outcome.error).toBe('HTTP 503');
    expect(outcome.retryAfter).toBe('12');
    expect(outcome.transportError).toBe(false);
  });

  it('collapses a rejected fetch into a retryable transport error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNRESET');
    });
    const outcome = await attemptDelivery({ ...base, fetchImpl, timeoutMs: 1_000 });

    expect(outcome).toMatchObject({
      statusCode: null,
      error: 'ECONNRESET',
      retryAfter: null,
      transportError: true,
    });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  // Edge case the inline block used to hide: a signing failure must not throw
  // out of deliverDue — the row is malformed input, and the batch continues.
  it('collapses a signing failure into the same transport-error shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const outcome = await attemptDelivery({
      ...base,
      signingKey: 'not-a-32-byte-key',
      fetchImpl,
      timeoutMs: 1_000,
    });

    expect(outcome.transportError).toBe(true);
    expect(outcome.error).toContain('WEBHOOK_SIGNING_KEY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up on a host that never answers, at the timeout', async () => {
    const hanging = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const outcome = await attemptDelivery({ ...base, fetchImpl: hanging, timeoutMs: 20 });

    expect(outcome.statusCode).toBeNull();
    expect(outcome.error).toBe('webhook timeout');
    expect(outcome.transportError).toBe(true);
  }, 10_000);
});
