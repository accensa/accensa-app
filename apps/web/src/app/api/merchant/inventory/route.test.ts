import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GET, PUT } from './route';

const {
  mockGetMerchant,
  mockWithClient,
  mockWithMerchantClient,
  mockEnsureSchema,
  mockIsAdmin,
  mockStockLevels,
  mockSetStockLevel,
} = vi.hoisted(() => ({
  mockGetMerchant: vi.fn(),
  mockWithClient: vi.fn(),
  mockWithMerchantClient: vi.fn(),
  mockEnsureSchema: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockStockLevels: vi.fn(),
  mockSetStockLevel: vi.fn(),
}));

vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mockGetMerchant }));
vi.mock('@/lib/db', () => ({
  ensureSchema: mockEnsureSchema,
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
}));
vi.mock('@/lib/rbac', () => ({ isAdmin: mockIsAdmin }));
vi.mock('@/lib/inventory/reservationManager', () => ({
  InventoryReservationManager: vi.fn(function () {
    return {
      stockLevels: mockStockLevels,
      setStockLevel: mockSetStockLevel,
    };
  }),
  PostgresInventoryReservationStore: vi.fn(),
}));

const DATABASE_URL_ORIG = process.env.DATABASE_URL;

function makeRequest(method: string, body?: unknown, options?: { raw?: string }) {
  return new Request('http://localhost/api/merchant/inventory', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:
      method === 'GET'
        ? undefined
        : (options?.raw ?? (body !== undefined ? JSON.stringify(body) : 'not json')),
  });
}

describe('/api/merchant/inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://localhost/test';
    mockWithClient.mockImplementation((fn: (c: unknown) => unknown) => fn({}));
    mockWithMerchantClient.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn({}));
    mockEnsureSchema.mockResolvedValue(undefined);
    mockGetMerchant.mockResolvedValue({ id: 'm1' });
    mockIsAdmin.mockReturnValue(true);
    mockStockLevels.mockResolvedValue([]);
    mockSetStockLevel.mockResolvedValue(true);
  });

  afterEach(() => {
    if (DATABASE_URL_ORIG !== undefined) {
      process.env.DATABASE_URL = DATABASE_URL_ORIG;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  // --- GET ---

  test('GET returns 503 when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(503);
  });

  test('GET returns 401 when caller is unresolved', async () => {
    mockGetMerchant.mockResolvedValue(null);
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(401);
  });

  test('GET returns 200 with Cache-Control: no-store', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const json = await res.json();
    expect(json).toHaveProperty('items');
  });

  // --- PUT ---

  test('PUT returns 503 when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await PUT(makeRequest('PUT', { items: [] }));
    expect(res.status).toBe(503);
  });

  test('PUT returns 401 when caller is unresolved', async () => {
    mockGetMerchant.mockResolvedValue(null);
    const res = await PUT(makeRequest('PUT', { items: [] }));
    expect(res.status).toBe(401);
  });

  test('PUT rejects non-JSON body with 400', async () => {
    const res = await PUT(makeRequest('PUT', undefined, { raw: 'not json' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  test('PUT rejects payload without items array with 400', async () => {
    const res = await PUT(makeRequest('PUT', { items: 'not-array' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('items must be an array with at most 100 entries');
  });

  test('PUT rejects non-object item at :67 as 400 not 500', async () => {
    const res = await PUT(makeRequest('PUT', { items: ['string-item'] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid inventory item');
  });

  test('PUT rejects item with bad field types at :80 as 400 not 500', async () => {
    const res = await PUT(
      makeRequest('PUT', {
        items: [{ sku: 123, name: 'Test', stockQuantity: 10, lowStockThreshold: 2 }],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid inventory item');
  });

  test('PUT returns 409 when write conflicts', async () => {
    mockSetStockLevel.mockResolvedValue(false);
    const res = await PUT(
      makeRequest('PUT', {
        items: [{ sku: 'SKU1', name: 'Widget', stockQuantity: 5, lowStockThreshold: 1 }],
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Stock cannot be lower than active reservations');
  });

  test('PUT returns 500 on unexpected error', async () => {
    mockWithMerchantClient.mockRejectedValue(new Error('db down'));
    const res = await PUT(
      makeRequest('PUT', {
        items: [{ sku: 'SKU1', name: 'Widget', stockQuantity: 5, lowStockThreshold: 1 }],
      }),
    );
    expect(res.status).toBe(500);
  });

  test('PUT returns success on valid input', async () => {
    const res = await PUT(
      makeRequest('PUT', {
        items: [{ sku: 'SKU1', name: 'Widget', stockQuantity: 10, lowStockThreshold: 2 }],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ updated: true });
  });
});
