import { describe, it, expect, vi } from 'vitest';
import {
  shouldRetry,
  parseRetryAfter,
  backoffMs,
  nextRetryAt,
  canonicalPayload,
  MAX_ATTEMPTS,
  DELIVERY_WINDOW_MS,
  deliverDue,
  enqueueWebhookDelivery,
  payloadFromRow,
} from './webhooks';

describe('shouldRetry', () => {
  it('retries 5xx, 429 and transport errors', () => {
    expect(shouldRetry(500, false)).toBe(true);
    expect(shouldRetry(503, false)).toBe(true);
    expect(shouldRetry(429, false)).toBe(true);
    expect(shouldRetry(null, true)).toBe(true);
  });

  it('does not retry other 4xx — a 404 is not a host that will recover', () => {
    expect(shouldRetry(400, false)).toBe(false);
    expect(shouldRetry(401, false)).toBe(false);
    expect(shouldRetry(404, false)).toBe(false);
  });

  it('does not retry 2xx', () => {
    expect(shouldRetry(200, false)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('honours delta-seconds', () => {
    expect(parseRetryAfter('12', 1_000)).toBe(13_000);
  });

  it('honours an HTTP-date', () => {
    const when = 'Wed, 21 Oct 2015 07:28:00 GMT';
    expect(parseRetryAfter(when, 0)).toBe(Date.parse(when));
  });

  it('returns null for garbage', () => {
    expect(parseRetryAfter('soon', 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});

describe('backoffMs', () => {
  it('is exponential with jitter in [base, 1.25*base]', () => {
    const random = () => 0.5;
    expect(backoffMs(1, random)).toBe(Math.floor(1000 + 500));
    expect(backoffMs(2, random)).toBe(Math.floor(2000 + 1000));
    expect(backoffMs(3, random)).toBe(Math.floor(4000 + 2000));
  });
});

describe('nextRetryAt', () => {
  it('returns null once the attempt budget is exhausted', () => {
    const now = 10_000;
    expect(nextRetryAt({ attempt: MAX_ATTEMPTS, createdAtMs: 0, now, random: () => 0 })).toBeNull();
  });

  it('returns null once the 24h window has elapsed', () => {
    const now = DELIVERY_WINDOW_MS + 1;
    expect(nextRetryAt({ attempt: 1, createdAtMs: 0, now, random: () => 0 })).toBeNull();
  });

  it('takes the later of backoff and Retry-After', () => {
    const now = 0;
    const at = nextRetryAt({
      attempt: 1,
      createdAtMs: 0,
      now,
      retryAfterHeader: '30',
      random: () => 0,
    });
    expect(at?.getTime()).toBe(30_000);
  });
});

describe('canonicalPayload', () => {
  it('emits a stable JSON object so the signature covers the exact body', () => {
    const body = canonicalPayload({
      tx_hash: 'aa',
      ledger: 1,
      payer: 'G',
      amount: '2',
      asset: 'native',
      ts: 't',
      route: '/x',
      method: 'GET',
    });
    expect(JSON.parse(body)).toEqual({
      tx_hash: 'aa',
      ledger: 1,
      payer: 'G',
      amount: '2',
      asset: 'native',
      ts: 't',
      route: '/x',
      method: 'GET',
    });
  });
});

describe('enqueueWebhookDelivery', () => {
  it('does not call fetch — indexing only persists a row', async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const query = vi.fn().mockResolvedValue({ rowCount: 1 });
      await enqueueWebhookDelivery(
        { query } as never,
        payloadFromRow({
          tx_hash: 'a'.repeat(64),
          ledger: 1,
          payer: 'G',
          amount: '1',
          asset: 'native',
          ts: new Date('2026-01-01T00:00:00.000Z'),
          route: null,
          method: null,
        }),
        'https://merchant.example/hook',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('deliverDue — a sleeping host cannot stall the caller past the budget', () => {
  it('returns before a webhook that never responds would exhaust the indexer budget', async () => {
    const hanging = () => new Promise<Response>(() => {});
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SET status = 'delivering'")) return { rowCount: 1, rows: [{ id: 1 }] };
      if (sql.includes('FROM webhook_deliveries')) {
        return {
          rows: [
            {
              id: '1',
              payment_tx_hash: 'a'.repeat(64),
              url: 'http://blackhole.test/hook',
              payload: {
                tx_hash: 'a'.repeat(64),
                ledger: 1,
                payer: 'G',
                amount: '1',
                asset: 'native',
                ts: 't',
                route: null,
                method: null,
              },
              attempts: 0,
              created_at: new Date(),
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const started = Date.now();
    await deliverDue({ query } as never, {
      fetchImpl: hanging as unknown as typeof fetch,
      signingKey: '11'.repeat(32),
      timeoutMs: 50,
      budgetMs: 200,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
  });
});
