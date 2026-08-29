import { describe, expect, it, vi } from 'vitest';
import { fetchAllPayments } from './payments-fetch';

interface Page {
  payments: Array<{ tx_hash: string }>;
  next_cursor: string | null;
  sync?: { lastLedger: number; updatedAt: string } | null;
}

/** A fake `/api/payments` that serves the given pages in order. */
function fakeApi(pages: Page[]): typeof fetch {
  let call = 0;
  return vi.fn(async (url: string | URL | Request) => {
    const requested = new URL(String(url), 'http://localhost');
    const cursor = requested.searchParams.get('cursor');
    // First call has no cursor; subsequent calls must carry the previous page's.
    if (call > 0) expect(cursor).toBe(pages[call - 1].next_cursor);
    const page = pages[call];
    call += 1;
    return {
      ok: true,
      json: async () => page,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('fetchAllPayments', () => {
  it('follows next_cursor to the end and concatenates every page', async () => {
    const pages: Page[] = [
      {
        payments: [{ tx_hash: 'a' }, { tx_hash: 'b' }],
        next_cursor: 'cur-1',
        sync: { lastLedger: 9, updatedAt: '2026-08-01T00:00:00Z' },
      },
      { payments: [{ tx_hash: 'c' }], next_cursor: 'cur-2' },
      { payments: [{ tx_hash: 'd' }], next_cursor: null },
    ];

    const result = await fetchAllPayments({ fetchImpl: fakeApi(pages) });

    expect(result.payments.map((p) => p.tx_hash)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.truncated).toBe(false);
    // sync comes from the first page only.
    expect(result.sync).toEqual({ lastLedger: 9, updatedAt: '2026-08-01T00:00:00Z' });
  });

  it('covers a history larger than a single 1,000-row page', async () => {
    const full = Array.from({ length: 1200 }, (_, i) => ({ tx_hash: `tx-${i}` }));
    const pages: Page[] = [
      { payments: full.slice(0, 1000), next_cursor: 'cur-1' },
      { payments: full.slice(1000), next_cursor: null },
    ];

    const result = await fetchAllPayments({ fetchImpl: fakeApi(pages) });

    expect(result.payments).toHaveLength(1200);
    expect(result.payments.length).toBeGreaterThan(100);
  });

  it('reports progress after each page', async () => {
    const pages: Page[] = [
      { payments: [{ tx_hash: 'a' }, { tx_hash: 'b' }], next_cursor: 'cur-1' },
      { payments: [{ tx_hash: 'c' }], next_cursor: null },
    ];
    const seen: number[] = [];

    await fetchAllPayments({ fetchImpl: fakeApi(pages), onProgress: (n) => seen.push(n) });

    expect(seen).toEqual([2, 3]);
  });

  it('surfaces the API error message on a failed page', async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    })) as unknown as typeof fetch;

    await expect(fetchAllPayments({ fetchImpl: failing })).rejects.toThrow('Internal Server Error');
  });
});
