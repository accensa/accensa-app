import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './[merchantId]';
import { withMerchantClient } from '../../../lib/db';
import { getMerchantByAddress } from '../../../lib/merchants';
import { revalidateCatalog } from '../../../../lib/cache/revalidate';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('../../../lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: vi.fn(async (cb) =>
    cb({
      query: vi.fn(),
    }),
  ),
  withMerchantClient: vi.fn(async (_id, cb) =>
    cb({
      query: vi.fn(),
    }),
  ),
}));

vi.mock('../../../lib/merchants', () => ({
  getMerchantByAddress: vi.fn(),
}));

vi.mock('../../../../lib/cache/revalidate', () => ({
  revalidateCatalog: vi.fn(),
}));

describe('Catalog API Handler [merchantId]', () => {
  let req: NextApiRequest;
  let res: NextApiResponse;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

    req = {
      method: 'GET',
      query: { merchantId: '123' },
      headers: { 'x-accensa-merchant': 'GACCENSA' },
      body: {},
    } as unknown as NextApiRequest;

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    } as unknown as NextApiResponse;

    vi.mocked(getMerchantByAddress).mockResolvedValue({
      id: 123,
      address: 'GACCENSA',
      publicKeyHex: null,
      assetContractIds: null,
      refundVaultId: null,
      webhookUrl: null,
    });
  });

  it('should return 400 for non-safe-integer or sub-1 merchantId (0)', async () => {
    req.query.merchantId = '0';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('should return 400 for merchantId (-1)', async () => {
    req.query.merchantId = '-1';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for non-numeric merchantId (abc)', async () => {
    req.query.merchantId = 'abc';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 503 when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Catalog is unavailable' }),
    );
  });

  it('should return 403 when PUT is called with viewer role', async () => {
    req.method = 'PUT';
    req.headers['x-accensa-role'] = 'viewer';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 400 for invalid SKU pattern (bad chars or length > 100)', async () => {
    req.method = 'PUT';
    req.body = {
      sku: 'INVALID@SKU!',
      name: 'Test Item',
      price: 10,
    };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    req.body = {
      sku: 'a'.repeat(101),
      name: 'Test Item',
      price: 10,
    };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should handle successful PUT upsert and return item', async () => {
    req.method = 'PUT';
    req.body = {
      sku: 'VALID-SKU_1.2:3',
      name: 'Valid Item',
      price: 19.99,
    };
    vi.mocked(withMerchantClient).mockImplementationOnce(async (_id, cb) =>
      cb({
        query: vi.fn().mockResolvedValueOnce({
          rows: [{ sku: 'VALID-SKU_1.2:3', name: 'Valid Item', price: '19.99' }],
        }),
      } as any),
    );

    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ item: expect.any(Object) }));
  });

  it('should report removal via rowCount === 1 on PUT with remove: true', async () => {
    req.method = 'PUT';
    req.body = {
      sku: 'VALID-SKU',
      remove: true,
    };
    vi.mocked(withMerchantClient).mockImplementationOnce(async (_id, cb) =>
      cb({
        query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }),
      } as any),
    );

    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ removed: true });
  });

  it('should validate item body (empty/overlong name, negative/NaN price, wrong types)', async () => {
    req.method = 'PUT';

    req.body = { sku: 'SKU1', name: '', price: 10 };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    req.body = { sku: 'SKU1', name: 'a'.repeat(161), price: 10 };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    req.body = { sku: 'SKU1', name: 'Item', price: -1 };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    req.body = { sku: 'SKU1', name: 'Item', price: NaN };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);

    req.body = { sku: 'SKU1', name: 'Item', price: '10' };
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return item list on GET', async () => {
    req.method = 'GET';
    vi.mocked(withMerchantClient).mockImplementationOnce(async (_id, cb) =>
      cb({
        query: vi.fn().mockResolvedValueOnce({
          rows: [{ sku: 'SKU1', name: 'Item 1', description: 'Desc', price: '10.00' }],
        }),
      } as any),
    );

    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 123,
        items: expect.any(Array),
      }),
    );
  });

  it('should handle POST ?revalidate=true success and error states', async () => {
    req.method = 'POST';
    req.query.revalidate = 'true';

    vi.mocked(revalidateCatalog).mockResolvedValueOnce({ revalidated: true });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ revalidated: true });

    vi.mocked(revalidateCatalog).mockResolvedValueOnce({
      revalidated: false,
      error: 'Error revalidating',
    });
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ revalidated: false, error: 'Error revalidating' });
  });

  it('should return 405 for unsupported methods', async () => {
    req.method = 'PATCH';
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Method not allowed' }));
  });
});

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
