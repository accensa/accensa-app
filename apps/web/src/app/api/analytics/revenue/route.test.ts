import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './route';

const MERCHANT = { id: 1, address: 'GABC' };
const mockQuery = vi.fn();

const { mockWithClient, mockWithMerchantClient, mockGetMerchantFromRequest } = vi.hoisted(() => ({
  mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  mockWithMerchantClient: vi.fn(
    async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: mockQuery }),
  ),
  mockGetMerchantFromRequest: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

/** The three sequential queries the route runs: days, routes, assets. */
function mockAggregates(opts: {
  days?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  assets?: Record<string, unknown>[];
}) {
  mockQuery
    .mockResolvedValueOnce({ rows: opts.days ?? [] })
    .mockResolvedValueOnce({ rows: opts.routes ?? [] })
    .mockResolvedValueOnce({ rows: opts.assets ?? [] });
}

describe('/api/analytics/revenue GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  const req = () => new Request('http://localhost/api/analytics/revenue');

  test('401 when the request names no known merchant', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test('500 without DATABASE_URL, and never leaks internals', async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });

  test('groups the SQL aggregates by asset and preserves exact decimals', async () => {
    mockAggregates({
      days: [
        {
          day: '2026-03-09T00:00:00.000000Z',
          asset_key: 'native',
          attributed: '3.0000000',
          unattributed: '1.0000000',
          attributed_calls: 3,
          unattributed_calls: 1,
          unpriced_calls: 0,
        },
        {
          day: '2026-03-10T00:00:00.000000Z',
          asset_key: 'native',
          attributed: '0',
          unattributed: '2.5000000',
          attributed_calls: 0,
          unattributed_calls: 1,
          unpriced_calls: 1,
        },
      ],
      routes: [
        {
          asset_key: 'native',
          method: 'GET',
          route: '/api/quote',
          total: '3.0000000',
          calls: 3,
          priced: 3,
        },
        { asset_key: 'native', method: null, route: null, total: '3.5000000', calls: 2, priced: 2 },
      ],
      assets: [{ asset_key: 'native', calls: 5 }],
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.assets).toEqual([{ key: 'native', label: 'XLM', calls: 5 }]);
    expect(data.days.native).toHaveLength(2);
    expect(data.days.native[0]).toMatchObject({ attributed: '3.0000000', unattributedCalls: 1 });
    expect(data.days.native[1]).toMatchObject({ unpricedCalls: 1 });

    // The route breakdown folds the null-route row into one unattributed bucket.
    expect(data.routes.native).toHaveLength(2);
    const unattributed = data.routes.native.find((r: { route: string | null }) => r.route === null);
    expect(unattributed).toMatchObject({ total: '3.5000000', calls: 2 });

    // The three GROUP BY queries actually ran.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [daySql] = mockQuery.mock.calls[0];
    expect(daySql).toMatch(/GROUP BY date_trunc\('day', ts\)/);
  });

  test('returns empty structures for a merchant with no payments', async () => {
    mockAggregates({});
    const data = await (await GET(req())).json();
    expect(data).toEqual({ assets: [], days: {}, routes: {} });
  });
});
