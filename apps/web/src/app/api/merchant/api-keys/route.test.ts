import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { mockWithClient, mockWithMerchantClient, mockQuery, mockMerchant } = vi.hoisted(() => {
  const merchant = { id: 42, address: `G${'A'.repeat(55)}` };
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  return {
    mockWithClient: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work({})),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, work: (client: unknown) => Promise<unknown>) => work({ query }),
    ),
    mockQuery: query,
    mockMerchant: vi.fn().mockResolvedValue(merchant),
  };
});

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mockMerchant }));

function request(body?: unknown) {
  return new Request('https://accensa.test/api/merchant/api-keys', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-accensa-role': 'admin' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/merchant/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mockMerchant.mockResolvedValue({ id: 42, address: `G${'A'.repeat(55)}` });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('lists keys from only the active store scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'key-id', name: 'Store key' }] });
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mockWithMerchantClient).toHaveBeenCalledWith(42, expect.any(Function));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE merchant_id = $1'), [42]);
  });

  it('returns an opaque secret once and stores only its hash under the current merchant', async () => {
    const response = await POST(request({ name: 'Store backend', permissions: ['read', 'write'] }));
    const result = (await response.json()) as { id: string; secret: string };

    expect(response.status).toBe(201);
    expect(result.secret).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(mockWithMerchantClient).toHaveBeenCalledWith(42, expect.any(Function));
    const insert = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO merchant_api_keys'),
    );
    expect(insert?.[1]).toContain(42);
    expect(insert?.[1]).not.toContain(result.secret);
    expect(insert?.[1]?.[4]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('denies key creation to viewer sessions', async () => {
    const response = await POST(
      new Request('https://accensa.test/api/merchant/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-accensa-role': 'viewer' },
        body: JSON.stringify({ name: 'No', permissions: ['read'] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
