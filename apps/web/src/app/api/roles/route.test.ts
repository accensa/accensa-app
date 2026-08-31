import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET, POST } from './route';

const { MERCHANT, mockWithClient, mockWithMerchantClient, mockGetMerchantFromRequest } =
  vi.hoisted(() => {
    const merchant = { id: 1, address: 'GABC' };
    return {
      MERCHANT: merchant,
      mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  mockWithMerchantClient: vi.fn(
    async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
      // The requesting merchant holds the owner relation, so view_dashboard
      // (GET) and manage_team (POST) both authorize — mirroring a real
      // seeding where the merchant that authenticated owns its store.
      fn({
        query: vi
          .fn()
          .mockResolvedValue({ rows: [{ relation: 'owner' }] }),
      }),
  ),
      mockGetMerchantFromRequest: vi.fn().mockResolvedValue(merchant),
    };
  });

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

function req(url = 'http://localhost/api/roles', init?: RequestInit): Request {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('x-accensa-sub')) headers.set('x-accensa-sub', 'GABC');
  if (!headers.has('x-accensa-merchant')) headers.set('x-accensa-merchant', 'GABC');
  return new Request(url, { ...init, headers });
}

describe('/api/roles (#180)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    delete process.env.SPICEDB_API_URL;
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  test('GET returns 401 when no merchant resolves', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test('GET lists the merchant role tuples', async () => {
    // Authorize succeeds because the shared mock client reports an empty
    // tuple set — in a real RLS store the requesting merchant would have been
    // seeded owner/editor/viewer so view_dashboard resolves. Here the default
    // empty check still returns 200 with an empty list.
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.merchant).toBe(MERCHANT.id);
    expect(Array.isArray(data.roles)).toBe(true);
  });

  test('POST rejects an invalid subject', async () => {
    const res = await POST(
      req('http://localhost/api/roles', {
        method: 'POST',
        body: JSON.stringify({ subject: 'not-a-userset', relation: 'viewer' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('POST rejects an ungrantable relation', async () => {
    const res = await POST(
      req('http://localhost/api/roles', {
        method: 'POST',
        body: JSON.stringify({ subject: 'user:u_abc', relation: 'super_admin' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test('POST grants a viewer tuple', async () => {
    const res = await POST(
      req('http://localhost/api/roles', {
        method: 'POST',
        body: JSON.stringify({ subject: 'user:u_abc', relation: 'viewer' }),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.subject).toBe('user:u_abc');
    expect(data.relation).toBe('viewer');
  });
});