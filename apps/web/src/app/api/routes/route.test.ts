import { expect, test, vi, describe, beforeEach } from 'vitest';
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

describe('/api/routes GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  const mockRequest = (url: string) => new Request(url);

  test('returns routes with default limit of 50', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      route: `/api/v1/resource/${i}`,
      method: 'GET',
      total_revenue: String(BigInt(i * 1000)),
      calls: i + 1,
    }));
    mockQuery.mockResolvedValue({ rows });

    const res = await GET(mockRequest('http://localhost/api/routes'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.routes).toHaveLength(30);
    expect(data.truncated).toBe(false);
    expect(data.default_window_days).toBe(30);
  });

  test('truncates results and adds (other) row when exceeding limit', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      route: `/api/v1/resource/${i}`,
      method: 'GET',
      total_revenue: String(BigInt((60 - i) * 1000)),
      calls: i + 1,
    }));
    mockQuery.mockResolvedValue({ rows });

    const res = await GET(mockRequest('http://localhost/api/routes?limit=10'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.routes).toHaveLength(11); // 10 kept + 1 (other)
    expect(data.truncated).toBe(true);

    const otherRow = data.routes[data.routes.length - 1];
    expect(otherRow.route).toBe('(other)');
    expect(otherRow.method).toBeNull();
    expect(otherRow.calls).toBeGreaterThan(0);
  });

  test('rejects limit below 1', async () => {
    const res = await GET(mockRequest('http://localhost/api/routes?limit=0'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('limit must be an integer between 1 and 200');
  });

  test('rejects limit above 200', async () => {
    const res = await GET(mockRequest('http://localhost/api/routes?limit=201'));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('limit must be an integer between 1 and 200');
  });

  test('rejects non-numeric limit', async () => {
    const res = await GET(mockRequest('http://localhost/api/routes?limit=abc'));
    expect(res.status).toBe(400);
  });

  test('accepts custom limit within bounds', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      route: `/api/v1/resource/${i}`,
      method: 'GET',
      total_revenue: String(BigInt(i * 1000)),
      calls: i + 1,
    }));
    mockQuery.mockResolvedValue({ rows });

    const res = await GET(mockRequest('http://localhost/api/routes?limit=5'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.routes).toHaveLength(5);
  });

  test('scopes the aggregate query to the resolved merchant', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await GET(mockRequest('http://localhost/api/routes'));
    const callArgs = mockQuery.mock.calls[0];
    const query = callArgs[0] as string;
    const params = callArgs[1] as (string | number)[];

    expect(query).toContain('merchant_id = $1');
    expect(query).toContain('ts >= $2');
    expect(params).toHaveLength(3); // merchant_id + from + limit
    expect(params[0]).toBe(MERCHANT.id);
  });

  test('respects custom from/to parameters', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await GET(mockRequest('http://localhost/api/routes?from=2026-01-01&to=2026-06-01'));
    const callArgs = mockQuery.mock.calls[0];
    const query = callArgs[0] as string;
    const params = callArgs[1] as (string | number)[];

    expect(query).toContain('ts >= $2');
    expect(query).toContain('ts <= $3');
    expect(params[1]).toBe('2026-01-01');
    expect(params[2]).toBe('2026-06-01');
  });

  test('does not include default_window_days when from is provided', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await GET(mockRequest('http://localhost/api/routes?from=2026-01-01'));
    const data = await res.json();
    expect(data.default_window_days).toBeNull();
  });

  test('returns 500 when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(mockRequest('http://localhost/api/routes'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('DATABASE_URL is not configured');
  });

  test('returns 401 when the request carries no resolvable merchant', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await GET(mockRequest('http://localhost/api/routes'));
    expect(res.status).toBe(401);
  });
});
