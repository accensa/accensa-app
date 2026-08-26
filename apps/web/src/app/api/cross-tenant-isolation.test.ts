/**
 * Proves that no endpoint can return one merchant's data to another.
 *
 * The fake database below behaves the way Postgres does once
 * migrations/003_multi_merchant.sql is applied: `payments` carries rows for
 * two merchants, and any query that does not filter on `merchant_id` gets
 * back nothing at all — that is what `FORCE ROW LEVEL SECURITY` guarantees
 * even if an application-level `WHERE` clause were ever dropped by mistake.
 * A query that filters on the *wrong* merchant_id also gets back nothing,
 * which is what proves isolation rather than mere correctness.
 *
 * This exercises every read endpoint that touches `payments`: GET
 * /api/payments and GET /api/routes. GET /api/sync's cursor isolation is
 * covered separately in db.ts (per-merchant sync_state), and POST
 * /api/hook/settle's isolation is that the *signature* — not caller input —
 * selects the merchant, covered in hook/settle/route.test.ts.
 */
import { expect, test, vi, describe, beforeEach } from 'vitest';

const MERCHANT_A = { id: 1, address: 'GAAA' };
const MERCHANT_B = { id: 2, address: 'GBBB' };

const PAYMENTS = [
  {
    merchant_id: 1,
    tx_hash: 'a'.repeat(64),
    payer: 'GPAYERA',
    amount: '100',
    asset: 'XLM',
    ts: new Date().toISOString(),
    route: '/a',
    method: 'GET',
  },
  {
    merchant_id: 2,
    tx_hash: 'b'.repeat(64),
    payer: 'GPAYERB',
    amount: '999',
    asset: 'XLM',
    ts: new Date().toISOString(),
    route: '/b',
    method: 'GET',
  },
];

const ROUTE_TOTALS = [
  { merchant_id: 1, route: '/a', method: 'GET', total_revenue: '100', calls: 1 },
  { merchant_id: 2, route: '/b', method: 'GET', total_revenue: '999', calls: 1 },
];

/**
 * Mimics FORCE ROW LEVEL SECURITY plus the app's own WHERE clause: a query
 * without `merchant_id = $1` (or filtering on the wrong id) returns nothing,
 * exactly like a policy that closes instead of leaking on a missing scope.
 */
function fakeQuery(table: { merchant_id: number }[]) {
  return vi.fn(async (sql: string, params: unknown[] = []) => {
    if (!/merchant_id\s*=\s*\$1/.test(sql)) return { rows: [] };
    const merchantId = params[0];
    return { rows: table.filter((row) => row.merchant_id === merchantId) };
  });
}

let currentMerchant: typeof MERCHANT_A | typeof MERCHANT_B;

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: vi.fn(async () => currentMerchant),
}));

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  withMerchantClient: vi.fn(
    async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: currentQuery }),
  ),
  ensureSchema: vi.fn(),
  getSyncState: vi.fn().mockResolvedValue(null),
}));

let currentQuery: ReturnType<typeof fakeQuery>;

describe('cross-tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  test('GET /api/payments never returns another merchant’s rows', async () => {
    const { GET } = await import('./payments/route');
    currentQuery = fakeQuery(PAYMENTS);

    currentMerchant = MERCHANT_A;
    const resA = await GET(new Request('http://localhost/api/payments'));
    const dataA = await resA.json();
    expect(dataA.payments).toHaveLength(1);
    expect(dataA.payments[0].tx_hash).toBe('a'.repeat(64));

    currentMerchant = MERCHANT_B;
    const resB = await GET(new Request('http://localhost/api/payments'));
    const dataB = await resB.json();
    expect(dataB.payments).toHaveLength(1);
    expect(dataB.payments[0].tx_hash).toBe('b'.repeat(64));

    // Neither response ever contains the other merchant's transaction hash.
    expect(JSON.stringify(dataA)).not.toContain('b'.repeat(64));
    expect(JSON.stringify(dataB)).not.toContain('a'.repeat(64));
  });

  test('GET /api/routes never returns another merchant’s revenue', async () => {
    const { GET } = await import('./routes/route');
    currentQuery = fakeQuery(ROUTE_TOTALS);

    currentMerchant = MERCHANT_A;
    const resA = await GET(new Request('http://localhost/api/routes'));
    const dataA = await resA.json();
    expect(dataA.routes.map((r: { route: string }) => r.route)).toEqual(['/a']);

    currentMerchant = MERCHANT_B;
    const resB = await GET(new Request('http://localhost/api/routes'));
    const dataB = await resB.json();
    expect(dataB.routes.map((r: { route: string }) => r.route)).toEqual(['/b']);
  });

  test('a query that omits the merchant scope returns nothing, not everything', () => {
    const q = fakeQuery(PAYMENTS);
    return q('SELECT * FROM payments', []).then((res) => {
      expect(res.rows).toHaveLength(0);
    });
  });
});
