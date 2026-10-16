import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const VAULT = `C${'D'.repeat(55)}`;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function storesPost(body: unknown, role: 'admin' | 'viewer' = 'admin') {
  return new Request('https://accensa.test/api/merchant/stores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-accensa-org-merchant': ORG,
      'x-accensa-role': role,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function storesGet() {
  return new Request('https://accensa.test/api/merchant/stores', {
    headers: { 'x-accensa-org-merchant': ORG, 'x-accensa-merchant': STORE },
  });
}

describe('/api/merchant/stores', () => {
  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    vi.restoreAllMocks();
  });

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

  it('GET returns 503 with no withClient call when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(storesGet());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database is unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('POST returns 503 with no withClient call when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database is unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('GET returns 401 when getMerchantByAddress resolves null', async () => {
    mockGetMerchantByAddress.mockResolvedValueOnce(null);
    const response = await GET(storesGet());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockGetMerchantByAddress).toHaveBeenCalledWith({}, ORG);
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('GET returns 500 when listing stores throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error('connection reset'));
    const response = await GET(storesGet());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to load stores' });
    expect(consoleError).toHaveBeenCalled();
  });

  it('POST returns 401 when the organization resolves null after validation passes', async () => {
    mockGetMerchantByAddress.mockResolvedValueOnce(null);
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockGetMerchantByAddress).toHaveBeenCalledWith({}, ORG);
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST returns 403 for a non-admin before any body parsing', async () => {
    const req = storesPost('{not json', 'viewer');
    const json = vi.spyOn(req, 'json');
    const response = await POST(req);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Only merchant admins can create stores' });
    expect(json).not.toHaveBeenCalled();
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST returns 400 for a body that is not valid JSON', async () => {
    const response = await POST(storesPost('{not json'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', '42'],
    ['a string', '"North"'],
    ['a boolean', 'true'],
    ['null', 'null'],
  ])('POST returns 400 for a JSON scalar body (%s)', async (_label, body) => {
    const response = await POST(storesPost(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid store' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST returns 400 for a JSON array body', async () => {
    const response = await POST(storesPost('[{"name":"North"}]'));

    // Arrays pass the `typeof === 'object'` guard and are rejected by the
    // field validation instead, so the message is the validation one.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'A store name and valid Stellar address are required',
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing name', { address: STORE }],
    ['a blank name', { name: '', address: STORE }],
    ['a whitespace-only name', { name: '   ', address: STORE }],
    ['a 121-character name', { name: 'n'.repeat(121), address: STORE }],
    ['a malformed refundVaultId', { name: 'North', address: STORE, refundVaultId: 'vault' }],
    ['a G... refundVaultId', { name: 'North', address: STORE, refundVaultId: STORE }],
    ['a non-string refundVaultId', { name: 'North', address: STORE, refundVaultId: 12 }],
  ])('POST returns 400 for %s before writing', async (_label, body) => {
    const response = await POST(storesPost(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'A store name and valid Stellar address are required',
    });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST accepts a valid C... refundVaultId and passes it through, trimming the name', async () => {
    const response = await POST(
      storesPost({ name: '  North  ', address: STORE, refundVaultId: VAULT }),
    );
    const result = (await response.json()) as { store: { name: string } };

    expect(response.status).toBe(201);
    expect(result.store.name).toBe('North');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO merchants'), [
      STORE,
      VAULT,
    ]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO merchant_stores'), [
      1,
      2,
      'North',
    ]);
  });

  it('POST stores a null refundVaultId when it is omitted', async () => {
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO merchants'), [
      STORE,
      null,
    ]);
  });

  it('POST accepts a name of exactly 120 characters', async () => {
    const response = await POST(storesPost({ name: 'n'.repeat(120), address: STORE }));

    expect(response.status).toBe(201);
  });

  it('POST returns 409 with the address-exists message for the store_address_exists sentinel', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO merchants')) throw new Error('store_address_exists');
      return { rows: [], rowCount: 1 };
    });
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That merchant address is already configured' });
    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockQuery).not.toHaveBeenCalledWith('COMMIT');
  });

  it('POST returns 409 with the address-exists message when the address insert returns no row', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO merchants')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'That merchant address is already configured' });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO merchant_stores'),
      expect.anything(),
    );
  });

  it("POST returns 409 with the name-exists message when the query throws { code: '23505' }", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO merchants'))
        return { rows: [{ id: 2, address: STORE }], rowCount: 1 };
      if (sql.includes('INSERT INTO merchant_stores')) throw { code: '23505' };
      return { rows: [], rowCount: 1 };
    });
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A store with that name already exists' });
    expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it.each([
    ['an unrelated Error', new Error('connection reset')],
    ['a non-unique Postgres code', { code: '23503' }],
    ['a thrown string', 'boom'],
  ])('POST returns 500 for any other thrown error (%s)', async (_label, thrown) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO merchants')) throw thrown;
      return { rows: [], rowCount: 1 };
    });
    const response = await POST(storesPost({ name: 'North', address: STORE }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to create store' });
    expect(consoleError).toHaveBeenCalled();
  });
});
