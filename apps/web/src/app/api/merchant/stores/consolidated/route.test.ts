import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { sumDecimalStrings } from './sum-decimal-strings';

const { mockWithClient, mockWithMerchantClient, mockQuery, mockGetMerchantByAddress } = vi.hoisted(
  () => {
    const query = vi.fn();
    return {
      mockWithClient: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work({})),
      mockWithMerchantClient: vi.fn(
        async (_merchantId: number, work: (client: unknown) => Promise<unknown>) =>
          work({ query }),
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

describe('sumDecimalStrings', () => {
  it('adds decimal values without floating-point precision loss', () => {
    expect(sumDecimalStrings(['0.1', '0.2', '10.0001'])).toBe('10.3001');
    expect(sumDecimalStrings(['1', '2.50'])).toBe('3.5');
    expect(sumDecimalStrings(['-0.5', '1.25'])).toBe('0.75');
  });
});

describe('GET /api/merchant/stores/consolidated', () => {
  const ORG = `G${'A'.repeat(55)}`;
  const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    }
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mockGetMerchantByAddress.mockResolvedValue({ id: 1, address: ORG });
    mockQuery.mockReset();
  });

  it('returns 503 with no withClient call when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: { 'x-accensa-org-merchant': ORG },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database is unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('returns 401 when no identity header is provided', async () => {
    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated'),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  it('returns 401 when a header resolves to no organization', async () => {
    mockGetMerchantByAddress.mockResolvedValueOnce(null);
    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: { 'x-accensa-org-merchant': ORG },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockWithClient).toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('takes precedence with x-accensa-org-merchant over x-accensa-merchant when both are present', async () => {
    const ORG_PRIMARY = `G${'P'.repeat(55)}`;
    const ORG_FALLBACK = `G${'F'.repeat(55)}`;

    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: {
          'x-accensa-org-merchant': ORG_PRIMARY,
          'x-accensa-merchant': ORG_FALLBACK,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockGetMerchantByAddress).toHaveBeenCalledWith(expect.anything(), ORG_PRIMARY);
    expect(mockGetMerchantByAddress).not.toHaveBeenCalledWith(expect.anything(), ORG_FALLBACK);
  });

  it('queries payments under each store own merchant id and merges totals using decimal-string addition', async () => {
    const orgId = 1;
    const store1MerchantId = 101;
    const store2MerchantId = 102;

    mockGetMerchantByAddress.mockResolvedValueOnce({ id: orgId, address: ORG });

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM merchant_stores')) {
        return {
          rows: [
            { id: 10, name: 'Store Alpha', merchant_id: store1MerchantId },
            { id: 20, name: 'Store Beta', merchant_id: store2MerchantId },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        const merchantId = params?.[0];
        if (merchantId === store1MerchantId) {
          return {
            rows: [{ asset: 'USDC', payment_count: '2', volume: '0.1' }],
          };
        }
        if (merchantId === store2MerchantId) {
          return {
            rows: [{ asset: 'USDC', payment_count: '3', volume: '0.2' }],
          };
        }
      }
      return { rows: [] };
    });

    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: { 'x-accensa-org-merchant': ORG },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stores: Array<{ storeId: number; name: string; paymentCount: number; assets: Array<{ asset: string; volume: string }> }>;
      totals: { paymentCount: number; assets: Array<{ asset: string; volume: string }> };
    };

    // Assert each store payments are queried under THAT store's own merchant id (not organization's id 1)
    expect(mockWithMerchantClient).toHaveBeenCalledWith(store1MerchantId, expect.any(Function));
    expect(mockWithMerchantClient).toHaveBeenCalledWith(store2MerchantId, expect.any(Function));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM payments WHERE merchant_id = $1'),
      [store1MerchantId],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM payments WHERE merchant_id = $1'),
      [store2MerchantId],
    );

    // Assert totals.paymentCount is the sum (2 + 3 = 5)
    expect(body.totals.paymentCount).toBe(5);

    // Assert decimal-string sum merges 0.1 and 0.2 into '0.3' without float precision loss (not 0.30000000000000004)
    expect(body.totals.assets).toEqual([{ asset: 'USDC', volume: '0.3' }]);

    expect(body.stores).toHaveLength(2);
    expect(body.stores[0]).toEqual({
      storeId: 10,
      name: 'Store Alpha',
      paymentCount: 2,
      assets: [{ asset: 'USDC', volume: '0.1' }],
    });
    expect(body.stores[1]).toEqual({
      storeId: 20,
      name: 'Store Beta',
      paymentCount: 3,
      assets: [{ asset: 'USDC', volume: '0.2' }],
    });
  });

  it('handles a store with zero payments with paymentCount 0 and no asset rows', async () => {
    const store1MerchantId = 101;
    const store2MerchantId = 102;

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM merchant_stores')) {
        return {
          rows: [
            { id: 10, name: 'Active Store', merchant_id: store1MerchantId },
            { id: 20, name: 'Empty Store', merchant_id: store2MerchantId },
          ],
        };
      }
      if (sql.includes('FROM payments')) {
        const merchantId = params?.[0];
        if (merchantId === store1MerchantId) {
          return {
            rows: [{ asset: 'native', payment_count: '4', volume: '100' }],
          };
        }
        if (merchantId === store2MerchantId) {
          return { rows: [] };
        }
      }
      return { rows: [] };
    });

    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: { 'x-accensa-org-merchant': ORG },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      stores: Array<{ storeId: number; name: string; paymentCount: number; assets: Array<{ asset: string; volume: string }> }>;
      totals: { paymentCount: number; assets: Array<{ asset: string; volume: string }> };
    };

    expect(body.stores[1]).toEqual({
      storeId: 20,
      name: 'Empty Store',
      paymentCount: 0,
      assets: [],
    });
    expect(body.totals.paymentCount).toBe(4);
    expect(body.totals.assets).toEqual([{ asset: 'native', volume: '100' }]);
  });

  it('yields 500 with no leaked error message when a query rejects', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Internal database connection failed with secret_token_xyz'));

    const response = await GET(
      new Request('https://accensa.test/api/merchant/stores/consolidated', {
        headers: { 'x-accensa-org-merchant': ORG },
      }),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Unable to load consolidated reporting' });
    expect(JSON.stringify(body)).not.toContain('secret_token_xyz');
    expect(JSON.stringify(body)).not.toContain('Internal database connection');
  });
});
