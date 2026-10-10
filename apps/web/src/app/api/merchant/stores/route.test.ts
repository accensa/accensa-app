import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { mockWithClient, mockWithMerchantClient, mockQuery, mockGetMerchantByAddress } = vi.hoisted(
  () => {
    const query = vi.fn();
    return {
      mockWithClient: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work({})),
      mockWithMerchantClient: vi.fn(
        async (_merchantId: number, work: (client: unknown) => Promise<unknown>) => work({ query }),
      ),
      mockQuery: query,
      mockGetMerchantByAddress: vi.fn().mockResolvedValue({ id: 1, address: `G${'A'.repeat(55)}` }),
    };
  },
);

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantByAddress: mockGetMerchantByAddress }));

const ORG = `G${'A'.repeat(55)}`;
const STORE = `G${'B'.repeat(55)}`;

describe('/api/merchant/stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mockGetMerchantByAddress.mockResolvedValue({ id: 1, address: ORG });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO merchants'))
        return { rows: [{ id: 2, address: STORE }], rowCount: 1 };
      if (sql.includes('INSERT INTO merchant_stores')) return { rows: [{ id: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
  });

  it('lists child stores only from the authenticated organization scope', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, merchant_id: 2, address: STORE, name: 'North', created_at: new Date() }],
    });
    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores', {
        headers: { 'x-accensa-org-merchant': ORG, 'x-accensa-merchant': STORE },
      }),
    );
    const result = (await response.json()) as { activeStoreId: number; stores: unknown[] };

    expect(response.status).toBe(200);
    expect(result.activeStoreId).toBe(7);
    expect(result.stores).toHaveLength(1);
    expect(mockWithMerchantClient).toHaveBeenCalledWith(1, expect.any(Function));
  });

  it('creates a child merchant, records its store association, and binds the organization owner', async () => {
    const response = await POST(
      new Request('https://accensa.test/api/merchant/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-accensa-org-merchant': ORG,
          'x-accensa-role': 'admin',
        },
        body: JSON.stringify({ name: 'North', address: STORE }),
      }),
    );
    const result = (await response.json()) as { store: { id: number; merchantId: number } };

    expect(response.status).toBe(201);
    expect(result.store).toMatchObject({ id: 7, merchantId: 2, address: STORE });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO merchant_stores'), [
      1,
      2,
      'North',
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'owner', $2, $3)"),
      ['merchant:2', `user:${ORG}`, 2],
    );
  });

  it('rejects invalid store addresses before writing', async () => {
    const response = await POST(
      new Request('https://accensa.test/api/merchant/stores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-accensa-org-merchant': ORG,
          'x-accensa-role': 'admin',
        },
        body: JSON.stringify({ name: 'North', address: 'not-a-stellar-address' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
