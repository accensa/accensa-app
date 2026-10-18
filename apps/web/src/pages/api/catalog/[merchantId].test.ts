import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './[merchantId]';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockWithClient, mockWithMerchantClient, mockQuery, mockGetMerchantByAddress, mockRevalidateCatalog } = vi.hoisted(() => {
  const query = vi.fn();
  return {
    mockWithClient: vi.fn(async (work: (client: unknown) => Promise<unknown>) => work({})),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, work: (client: unknown) => Promise<unknown>) => work({ query }),
    ),
    mockQuery: query,
    mockGetMerchantByAddress: vi.fn().mockResolvedValue({ id: 1, address: 'G' + 'A'.repeat(55) }),
    mockRevalidateCatalog: vi.fn().mockResolvedValue({ revalidated: true }),
  };
});

vi.mock('../../../lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
}));

vi.mock('../../../lib/merchants', () => ({
  getMerchantByAddress: mockGetMerchantByAddress,
}));

vi.mock('../../../../lib/cache/revalidate', () => ({
  revalidateCatalog: mockRevalidateCatalog,
}));

function createMockReqRes(overrides: {
  method?: string;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = {
    method: overrides.method ?? 'GET',
    query: overrides.query ?? { merchantId: '1' },
    headers: overrides.headers ?? { 'x-accensa-merchant': 'G' + 'A'.repeat(55) },
    body: overrides.body ?? {},
  } as unknown as NextApiRequest;

  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonResponse: unknown = null;

  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((data: unknown) => {
      jsonResponse = data;
      return res;
    }),
    revalidate: vi.fn(),
  } as unknown as NextApiResponse;

  return {
    req,
    res,
    getCode: () => statusCode,
    getJson: () => jsonResponse,
  };
}

describe('API /api/catalog/[merchantId]', () => {
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
    mockGetMerchantByAddress.mockResolvedValue({ id: 1, address: 'G' + 'A'.repeat(55) });
    mockQuery.mockReset();
  });

  it('rejects non-safe-integer or sub-1 merchantId with 400', async () => {
    for (const invalidId of ['0', '-1', 'abc', '1.5']) {
      const { req, res, getCode, getJson } = createMockReqRes({
        query: { merchantId: invalidId },
      });
      await handler(req, res);
      expect(getCode()).toBe(400);
      expect(getJson()).toEqual({ error: 'Invalid merchant id' });
    }
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  it('answers 503 when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const { req, res, getCode, getJson } = createMockReqRes({
      query: { merchantId: '1' },
    });
    await handler(req, res);
    expect(getCode()).toBe(503);
    expect(getJson()).toEqual({ error: 'Catalog is unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  it('handles POST ?revalidate=true successfully (200) or on failure (500)', async () => {
    mockRevalidateCatalog.mockResolvedValueOnce({ revalidated: true });
    const { req, res, getCode, getJson } = createMockReqRes({
      method: 'POST',
      query: { merchantId: '1', revalidate: 'true' },
    });
    await handler(req, res);
    expect(getCode()).toBe(200);
    expect(getJson()).toEqual({ revalidated: true });

    mockRevalidateCatalog.mockResolvedValueOnce({ revalidated: false, error: 'Failed' });
    const { req: reqFail, res: resFail, getCode: getCodeFail, getJson: getJsonFail } = createMockReqRes({
      method: 'POST',
      query: { merchantId: '1', revalidate: 'true' },
    });
    await handler(reqFail, resFail);
    expect(getCodeFail()).toBe(500);
    expect(getJsonFail()).toEqual({ revalidated: false, error: 'Failed' });
  });

  it('GETs catalog items successfully', async () => {
    const mockItems = [
      { sku: 'ITEM-1', name: 'Product One', description: 'Desc', price: '10.00' },
    ];
    mockQuery.mockResolvedValueOnce({ rows: mockItems });

    const { req, res, getCode, getJson } = createMockReqRes({
      method: 'GET',
      query: { merchantId: '1' },
    });
    await handler(req, res);

    expect(getCode()).toBe(200);
    expect(getJson()).toEqual({ merchantId: 1, items: mockItems });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('blocks a viewer role on PUT with 403', async () => {
    const { req, res, getCode, getJson } = createMockReqRes({
      method: 'PUT',
      query: { merchantId: '1' },
      headers: {
        'x-accensa-merchant': 'G' + 'A'.repeat(55),
        'x-accensa-role': 'viewer',
      },
      body: { sku: 'SKU-1', name: 'Test' },
    });
    await handler(req, res);
    expect(getCode()).toBe(403);
    expect(getJson()).toEqual({ error: 'Admin access required' });
  });

  it('enforces SKU pattern /^[A-Za-z0-9._:-]{1,100}$/ and returns 400 for invalid SKUs', async () => {
    for (const badSku of ['', 'invalid sku!', 'a'.repeat(101)]) {
      const { req, res, getCode, getJson } = createMockReqRes({
        method: 'PUT',
        query: { merchantId: '1' },
        headers: {
          'x-accensa-merchant': 'G' + 'A'.repeat(55),
          'x-accensa-role': 'admin',
        },
        body: { sku: badSku, name: 'Valid Name' },
      });
      await handler(req, res);
      expect(getCode()).toBe(400);
      expect(getJson()).toEqual({ error: 'A valid SKU is required' });
    }
  });

  it('reports removal via rowCount === 1 correctly', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const { req: req1, res: res1, getCode: getCode1, getJson: getJson1 } = createMockReqRes({
      method: 'PUT',
      query: { merchantId: '1' },
      headers: {
        'x-accensa-merchant': 'G' + 'A'.repeat(55),
        'x-accensa-role': 'admin',
      },
      body: { sku: 'SKU-1', remove: true },
    });
    await handler(req1, res1);
    expect(getCode1()).toBe(200);
    expect(getJson1()).toEqual({ removed: true });

    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const { req: req0, res: res0, getCode: getCode0, getJson: getJson0 } = createMockReqRes({
      method: 'PUT',
      query: { merchantId: '1' },
      headers: {
        'x-accensa-merchant': 'G' + 'A'.repeat(55),
        'x-accensa-role': 'admin',
      },
      body: { sku: 'SKU-1', remove: true },
    });
    await handler(req0, res0);
    expect(getCode0()).toBe(200);
    expect(getJson0()).toEqual({ removed: false });
  });

  it('validates the item body (empty/trimmed name, length <= 160, description type, price finite and >= 0)', async () => {
    const invalidBodies = [
      { sku: 'SKU-1', name: '' },
      { sku: 'SKU-1', name: '   ' },
      { sku: 'SKU-1', name: 'a'.repeat(161) },
      { sku: 'SKU-1', name: 'Valid', description: 123 },
      { sku: 'SKU-1', name: 'Valid', price: -1 },
      { sku: 'SKU-1', name: 'Valid', price: NaN },
      { sku: 'SKU-1', name: 'Valid', price: Infinity },
      { sku: 'SKU-1', name: 'Valid', price: '10' },
    ];

    for (const body of invalidBodies) {
      const { req, res, getCode, getJson } = createMockReqRes({
        method: 'PUT',
        query: { merchantId: '1' },
        headers: {
          'x-accensa-merchant': 'G' + 'A'.repeat(55),
          'x-accensa-role': 'admin',
        },
        body,
      });
      await handler(req, res);
      expect(getCode()).toBe(400);
      expect(getJson()).toEqual({ error: 'Invalid catalog item' });
    }
  });

  it('upserts valid item on conflict and returns the item', async () => {
    const upsertedItem = {
      sku: 'SKU-1',
      name: 'Product One',
      description: 'Desc',
      price: '15.00',
    };
    mockQuery.mockResolvedValueOnce({
      rows: [upsertedItem],
    });

    const { req, res, getCode, getJson } = createMockReqRes({
      method: 'PUT',
      query: { merchantId: '1' },
      headers: {
        'x-accensa-merchant': 'G' + 'A'.repeat(55),
        'x-accensa-role': 'admin',
      },
      body: {
        sku: 'SKU-1',
        name: ' Product One ',
        description: 'Desc',
        price: 15.0,
      },
    });
    await handler(req, res);

    expect(getCode()).toBe(200);
    expect(getJson()).toEqual({ item: upsertedItem });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO merchant_catalog_items'),
      expect.any(Array),
    );
  });

  it('answers 405 for unsupported HTTP methods', async () => {
    for (const method of ['DELETE', 'PATCH', 'OPTIONS']) {
      const { req, res, getCode, getJson } = createMockReqRes({
        method,
        query: { merchantId: '1' },
      });
      await handler(req, res);
      expect(getCode()).toBe(405);
      expect(getJson()).toEqual({ error: 'Method not allowed' });
    }
  });
});
