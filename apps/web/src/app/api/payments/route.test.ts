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
  });
});
