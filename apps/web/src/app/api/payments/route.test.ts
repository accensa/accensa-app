import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET } from './route';

const {
  MERCHANT,
  mockWithClient,
  mockWithMerchantClient,
  mockGetSyncState,
  mockGetMerchantFromRequest,
} = vi.hoisted(() => {
  const merchant = { id: 1, address: 'GABC' };
  return {
    MERCHANT: merchant,
    mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
        fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
    ),
    mockGetSyncState: vi.fn().mockResolvedValue(null),
    mockGetMerchantFromRequest: vi.fn().mockResolvedValue(merchant),
  };
});

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
  getSyncState: mockGetSyncState,
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

vi.mock('@/lib/receipt-anchor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/receipt-anchor')>();
  return {
    ...mod,
    getMaxBatchSize: vi.fn().mockResolvedValue(1000),
  };
});

describe('/api/payments GET', () => {
  const mockRequest = (url: string) => {
    return new Request(url);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  describe('limit validation', () => {
    test('rejects non-numeric limit (e.g. abc)', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?limit=abc'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('limit must be an integer between 1 and 1000');
    });

    test('rejects negative limit (-1)', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?limit=-1'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('limit must be an integer between 1 and 1000');
    });

    test('rejects 0 limit', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?limit=0'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('limit must be an integer between 1 and 1000');
    });

    test('rejects limit > 1000', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?limit=1001'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('limit must be an integer between 1 and 1000');
    });

    test('rejects float limit', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?limit=10.5'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('limit must be an integer between 1 and 1000');
    });
  });

  describe('page validation', () => {
    test('rejects non-numeric page (e.g. abc)', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?page=abc'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('page must be an integer >= 1');
    });

    test('rejects page 0 and negative pages', async () => {
      for (const page of ['0', '-1']) {
        const res = await GET(mockRequest(`http://localhost/api/payments?page=${page}`));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe('page must be an integer >= 1');
      }
    });

    test('rejects float page', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?page=1.5'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('page must be an integer >= 1');
    });

    test('rejects combining page and cursor', async () => {
      const cursor = Buffer.from(`${new Date().toISOString()}|${'a'.repeat(64)}`).toString(
        'base64',
      );
      const res = await GET(mockRequest(`http://localhost/api/payments?page=2&cursor=${cursor}`));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('page and cursor cannot be combined');
    });
  });

  describe('cursor validation', () => {
    test('rejects non-base64 cursor', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?cursor=not-base64-!@#$'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_cursor');
    });

    test('rejects cursor without |', async () => {
      const cursor = Buffer.from('invalidcursor').toString('base64');
      const res = await GET(mockRequest(`http://localhost/api/payments?cursor=${cursor}`));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_cursor');
    });

    test('rejects cursor with invalid timestamp', async () => {
      const cursor = Buffer.from('not-a-date|a'.repeat(64)).toString('base64');
      const res = await GET(mockRequest(`http://localhost/api/payments?cursor=${cursor}`));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_cursor');
    });

    test('rejects cursor with invalid hash length', async () => {
      const cursor = Buffer.from(`${new Date().toISOString()}|tooshort`).toString('base64');
      const res = await GET(mockRequest(`http://localhost/api/payments?cursor=${cursor}`));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_cursor');
    });
  });

  describe('merchant scoping', () => {
    test('returns 401 when the request carries no resolvable merchant', async () => {
      mockGetMerchantFromRequest.mockResolvedValue(null);
      const res = await GET(mockRequest('http://localhost/api/payments'));
      expect(res.status).toBe(401);
    });

    test('scopes the query to the resolved merchant', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      mockWithMerchantClient.mockImplementationOnce(
        async (merchantId: number, fn: (client: unknown) => Promise<unknown>) => {
          expect(merchantId).toBe(MERCHANT.id);
          return fn({ query });
        },
      );

      const res = await GET(mockRequest('http://localhost/api/payments'));
      expect(res.status).toBe(200);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('merchant_id = $1');
      expect(params[0]).toBe(MERCHANT.id);
    });

    test('sets Cache-Control no-store headers on successful response', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments'));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('no-store');
    });
  });

  describe('totals and pagination (>100 payments)', () => {
    test('computes total_count and total_amount across full dataset when payments exceed limit (fixture with 150 payments)', async () => {
      // 150 payment fixture
      const fixtureRows = Array.from({ length: 150 }, (_, i) => ({
        tx_hash: `hash_${String(i).padStart(64, '0').slice(-64)}`,
        ledger: 1000 + i,
        payer: 'GPAYER',
        amount: '10.50',
        asset: 'USDC',
        ts: new Date(Date.now() - i * 1000).toISOString(),
        route: '/api/v1/pay',
        method: 'POST',
      }));

      // Mock database queries:
      // 1st query: count & sum aggregate
      // 2nd query: limited rows (newest 100)
      const query = vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('count(*)')) {
          return Promise.resolve({
            rows: [{ total_count: '150', total_amount: '1575.00' }],
          });
        }
        // Default limit = 100 rows
        return Promise.resolve({
          rows: fixtureRows.slice(0, 100),
        });
      });

      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => {
          return fn({ query });
        },
      );

      const res = await GET(mockRequest('http://localhost/api/payments'));
      expect(res.status).toBe(200);
      const data = await res.json();

      // Only newest 100 returned in the payments array
      expect(data.payments).toHaveLength(100);
      // Total count reflects all 150 payments
      expect(data.total_count).toBe(150);
      // Total amount reflects full sum
      expect(data.total_amount).toBe('1575.00');
      // next_cursor is present because rows.length === limit
      expect(data.next_cursor).toBeTruthy();
    });
  });

  describe('offset pagination', () => {
    const row = {
      tx_hash: 'a'.repeat(64),
      ledger: 42,
      payer: 'GPAYER',
      amount: '1000',
      asset: 'XLM',
      ts: new Date('2026-08-20T07:22:16Z'),
      route: '/api/hello',
      method: 'GET',
      total: 120,
      total_amount: '120000',
      total_asset: 'XLM',
    };

    const queryFor = (rows: unknown[]) => vi.fn().mockResolvedValue({ rows });

    test('page=2&limit=50 translates to LIMIT 50 OFFSET 50', async () => {
      const query = queryFor([row]);
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(mockRequest('http://localhost/api/payments?page=2&limit=50'));
      expect(res.status).toBe(200);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('LIMIT $2');
      expect(sql).toContain('OFFSET $3');
      expect(params).toEqual([MERCHANT.id, 50, 50]);
    });

    test('no page parameter defaults to page 1, i.e. OFFSET 0', async () => {
      const query = queryFor([]);
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(mockRequest('http://localhost/api/payments?limit=25'));
      expect(res.status).toBe(200);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('LIMIT $2');
      expect(sql).toContain('OFFSET $3');
      expect(params).toEqual([MERCHANT.id, 25, 0]);
    });

    test('page 3 with limit 50 offsets by 100', async () => {
      const query = queryFor([]);
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      await GET(mockRequest('http://localhost/api/payments?page=3&limit=50'));
      const [, params] = query.mock.calls[0];
      expect(params).toEqual([MERCHANT.id, 50, 100]);
    });

    test('returns aggregates from the window columns', async () => {
      const query = queryFor([row]);
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(mockRequest('http://localhost/api/payments?page=1&limit=50'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(120);
      expect(data.total_amount).toBe('120000');
      expect(data.total_asset).toBe('XLM');
      expect(data.total_pages).toBe(3);
    });

    test('reports zero totals on an empty result', async () => {
      const query = queryFor([]);
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(mockRequest('http://localhost/api/payments?page=1&limit=50'));
      const data = await res.json();
      expect(data.total).toBe(0);
      expect(data.total_amount).toBe('0');
      expect(data.total_asset).toBeNull();
      expect(data.total_pages).toBe(0);
    });
  });

  describe('filters (#167)', () => {
    test('rejects unknown parameters loudly', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?routee=/api/pay'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('unknown parameter: routee');
    });

    test('rejects a date_from that is not a valid date', async () => {
      const res = await GET(mockRequest('http://localhost/api/payments?date_from=not-a-date'));
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('date_from must be a valid date');
    });

    test('rejects a date range where from is after to', async () => {
      const res = await GET(
        mockRequest(
          'http://localhost/api/payments?date_from=2026-09-01T00:00:00Z&date_to=2026-08-01T00:00:00Z',
        ),
      );
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('date_from must be on or before date_to');
    });

    test('adds filter predicates to the query and reports filter_info', async () => {
      const query = vi.fn().mockResolvedValue({
        rows: [
          {
            tx_hash: 'a'.repeat(64),
            ledger: 1,
            payer: 'GPAYER',
            amount: '10',
            asset: 'XLM',
            ts: new Date('2026-08-20T07:22:16Z'),
            route: '/api/v1/pay',
            method: 'POST',
          },
        ],
      });
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(
        mockRequest(
          'http://localhost/api/payments?route=/api/v1/pay&payer=GPAYER&asset=XLM&date_from=2026-08-01T00:00:00Z&date_to=2026-08-31T00:00:00Z',
        ),
      );
      expect(res.status).toBe(200);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('route = $2');
      expect(sql).toContain('payer = $3');
      expect(sql).toContain('asset = $4');
      expect(sql).toContain('ts >= $5');
      expect(sql).toContain('ts <= $6');
      expect(params[0]).toBe(MERCHANT.id);
      const data = await res.json();
      expect(data.filter_info).toEqual({
        route: '/api/v1/pay',
        payer: 'GPAYER',
        asset: 'XLM',
        date_from: '2026-08-01T00:00:00Z',
        date_to: '2026-08-31T00:00:00Z',
      });
    });

    test('applies filters to the aggregate query and the page query', async () => {
      const countSql: string[] = [];
      const pageSql: string[] = [];
      const query = vi
        .fn()
        .mockImplementation((sql: string, params: unknown[]) => {
          if (sql.includes('count(*)')) {
            countSql.push(sql);
            return Promise.resolve({
              rows: [{ total_count: '1', total_amount: '10' }],
            });
          }
          pageSql.push(sql);
          return Promise.resolve({ rows: [] });
        });
      mockWithMerchantClient.mockImplementationOnce(
        async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      );

      const res = await GET(
        mockRequest('http://localhost/api/payments?payer=GPAYER&limit=2'),
      );
      expect(res.status).toBe(200);
      expect(countSql).toHaveLength(1);
      expect(pageSql).toHaveLength(1);
      expect(countSql[0]).toContain('payer = $2');
      expect(pageSql[0]).toContain('payer = $2');
      const [, countParams] = query.mock.calls[0];
      expect(countParams).toEqual([MERCHANT.id, 'GPAYER']);
    });
  });
});
