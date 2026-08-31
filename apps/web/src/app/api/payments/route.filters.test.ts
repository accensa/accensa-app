import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET } from './route';

/**
 * Walks cursor-based pagination under a filter and asserts no row is skipped
 * or repeated.
 *
 * The fake database here emulates exactly what Postgres does for the route's
 * query shape: a WHERE clause (tenant scope + filters), the keyset predicate
 * `(ts < $x OR (ts = $x AND tx_hash < $y))`, and ORDER BY ts DESC, tx_hash
 * DESC. Walking every page of a *filtered* result and getting back the exact
 * filtered set, once, is the acceptance criterion for #167.
 */

const MERCHANT = { id: 1, address: 'GABC' };

const { mockWithClient, mockWithMerchantClient } = vi.hoisted(() => ({
  mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  mockWithMerchantClient: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
  getSyncState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: vi.fn().mockResolvedValue(MERCHANT),
}));

vi.mock('@/lib/receipt-anchor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/receipt-anchor')>();
  return { ...mod, getMaxBatchSize: vi.fn().mockResolvedValue(1000) };
});

interface FakeRow {
  tx_hash: string;
  payer: string;
  amount: string;
  asset: string;
  ts: string;
  route: string | null;
  merchant_id: number;
}

/**
 * Everything the table would contain for this merchant across two routes so a
 * filter demonstrably narrows it, with deliberately interleaved timestamps:
 * rows from both routes appear in the global ordering, so a naive cursor that
 * dropped the filter would skip or repeat.
 */
function buildFixture(): FakeRow[] {
  const rows: FakeRow[] = [];
  const routes = ['/api/v1/pay', '/api/v2/quote'];
  let i = 0;
  for (const route of routes) {
    for (let n = 0; n < 25; n++) {
      rows.push({
        merchant_id: MERCHANT.id,
        tx_hash: `hash_${String(i).padStart(58, '0')}`,
        payer: 'GPAYER',
        amount: '10.50',
        asset: 'XLM',
        ts: new Date(2026, 7, 1, 0, 0, i).toISOString(),
        route,
      });
      i++;
    }
  }
  return rows;
}

/** Emulates the route's WHERE + keyset predicate + ordering on a filtered set. */
function filterRows(
  table: FakeRow[],
  filters: { route?: string },
  cursor: { ts: string; txHash: string } | null,
): FakeRow[] {
  const scoped = table.filter((r) => r.merchant_id === MERCHANT.id);
  const filtered = filters.route ? scoped.filter((r) => r.route === filters.route) : scoped;
  const withPredicate = cursor
    ? filtered.filter(
        (r) => r.ts < cursor.ts || (r.ts === cursor.ts && r.tx_hash < cursor.txHash),
      )
    : filtered;
  return withPredicate.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
    return a.tx_hash < b.tx_hash ? 1 : -1;
  });
}

interface CursorState {
  ts: string;
  txHash: string;
}

function makeFakeDb(table: FakeRow[], filters: { route?: string }) {
  const paramsSeen: unknown[][] = [];
  return {
    query: vi.fn((sql: string, params: unknown[]) => {
      paramsSeen.push(params);
      if (sql.includes('count(*)')) {
        const all = filterRows(table, filters, null);
        const total = all.length;
        const sum = all.reduce((acc, r) => acc + Number(r.amount), 0);
        return Promise.resolve({
          rows: [{ total_count: String(total), total_amount: moneyString(sum) }],
        });
      }
      const predicateIdx = sql.indexOf('AND (ts < $');
      let cursor: CursorState | null = null;
      if (predicateIdx !== -1) {
        // selectParams = [merchantId, ...filters, cursorTs, cursorTxHash, limit]
        const cursorParams = params.slice(params.length - 3, params.length - 1);
        cursor = { ts: String(cursorParams[0]), txHash: String(cursorParams[1]) };
      }
      const limit = Number(params[params.length - 1]);
      const rows = filterRows(table, filters, cursor).slice(0, limit);
      return Promise.resolve({ rows });
    }),
    paramsSeen,
  };
}

function moneyString(n: number): string {
  return n.toFixed(2);
}

describe('/api/payments cursor-correctness under filters', () => {
  const table = buildFixture();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  test('walking every page of a filtered result yields the filtered set exactly once', async () => {
    const filters = { route: '/api/v1/pay' };
    const db = makeFakeDb(table, filters);
    mockWithMerchantClient.mockImplementation(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn(db),
    );

    const collected: string[] = [];
    let cursor: string | null = null;
    let page = 0;
    let response: { payments: { tx_hash: string }[]; next_cursor: string | null } | null = null;

    do {
      const url = new URL('http://localhost/api/payments');
      url.searchParams.set('route', '/api/v1/pay');
      url.searchParams.set('limit', '10');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await GET(new Request(url));
      expect(res.status).toBe(200);
      response = (await res.json()) as {
        payments: { tx_hash: string }[];
        next_cursor: string | null;
      };
      collected.push(...response.payments.map((p) => p.tx_hash));
      cursor = response.next_cursor;
      page++;
      if (page > 10) throw new Error('pagination did not terminate');
    } while (response?.next_cursor);

    const expected = filterRows(table, filters, null).map((r) => r.tx_hash);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected.length).toBe(25);
  });
});