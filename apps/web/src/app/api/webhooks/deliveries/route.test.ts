import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { mockQuery, mockWithClient, mockWithMerchantClient, mockMerchant, mockDeliverDue } =
  vi.hoisted(() => {
    const query = vi.fn();
    const merchant = { id: 7, address: 'GABC', webhookUrl: 'https://merchant.example/hook' };
    return {
      mockQuery: query,
      mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({ query })),
      mockWithMerchantClient: vi.fn(
        async (_id: number, fn: (client: unknown) => Promise<unknown>) => fn({ query }),
      ),
      mockMerchant: vi.fn(async () => merchant),
      mockDeliverDue: vi.fn(async () => ({ attempted: 1, delivered: 1, failed: 0, retried: 0 })),
    };
  });

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
}));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mockMerchant }));
vi.mock('@/lib/webhooks', () => ({ deliverDue: mockDeliverDue }));

const request = (url: string, init?: RequestInit) =>
  new Request(url, { headers: { 'x-accensa-merchant': 'GABC' }, ...init });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://test';
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockMerchant.mockResolvedValue({ id: 7, address: 'GABC', webhookUrl: 'https://merchant.example/hook' });
});

describe('/api/webhooks/deliveries', () => {
  it('scopes delivery history to the authenticated merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '3', payload: { tx_hash: 'abc' } }] });

    const response = await GET(request('http://localhost/api/webhooks/deliveries'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      endpoint: 'https://merchant.example/hook',
      deliveries: [{ id: '3' }],
    });
    expect(mockWithMerchantClient).toHaveBeenCalledWith(7, expect.any(Function));
    expect(mockQuery.mock.calls[0][1]).toEqual([7]);
  });

  it('rejects malformed retry requests', async () => {
    const response = await POST(
      request('http://localhost/api/webhooks/deliveries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliveryId: 0 }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'deliveryId must be a positive integer',
    });
  });

  it('redelivers only a failed row owned by the authenticated merchant', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const response = await POST(
      request('http://localhost/api/webhooks/deliveries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliveryId: 19 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([19, 7]);
    expect(mockDeliverDue).toHaveBeenCalledWith(expect.anything(), {
      deliveryId: 19,
      merchantId: 7,
    });
  });
});
