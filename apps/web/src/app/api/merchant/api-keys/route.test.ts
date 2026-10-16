import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function rawPost(body: string) {
  return new Request('https://accensa.test/api/merchant/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-accensa-role': 'admin' },
    body,
  });
}

function sqlCalls(fragment: string) {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes(fragment));
}

describe('/api/merchant/api-keys', () => {
  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  });

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

  it('GET returns 503 without touching the database when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('POST returns 503 without touching the database when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const response = await POST(request({ name: 'Store backend' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Database unavailable' });
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('GET returns 401 when the request resolves to no merchant', async () => {
    mockMerchant.mockResolvedValueOnce(null);
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('POST returns 401 when the request resolves to no merchant', async () => {
    mockMerchant.mockResolvedValueOnce(null);
    const response = await POST(request({ name: 'Store backend' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a body that is not valid JSON with 400', async () => {
    const response = await POST(rawPost('{not json'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', '42'],
    ['a string', '"name"'],
    ['null', 'null'],
    ['a boolean', 'true'],
  ])('rejects a JSON body that is %s with 400', async (_label, body) => {
    const response = await POST(rawPost(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid API key request' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['not a UUID', 'not-a-uuid'],
    ['too short', '1234-5678'],
    ['not a string', 12345],
  ])('rejects a revokeId that is %s with 400 and never issues the UPDATE', async (_label, id) => {
    const response = await POST(request({ revokeId: id }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid key id' });
    expect(sqlCalls('UPDATE merchant_api_keys')).toHaveLength(0);
    expect(mockWithMerchantClient).not.toHaveBeenCalled();
  });

  it('revokes a key scoped to the current merchant and returns 200', async () => {
    const keyId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const response = await POST(request({ revokeId: keyId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    const [update] = sqlCalls('UPDATE merchant_api_keys');
    expect(update?.[0]).toContain('revoked_at IS NULL');
    expect(update?.[1]).toEqual([42, keyId]);
  });

  it('returns 404 when the revoke UPDATE matches no row (wrong merchant or already revoked)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const response = await POST(request({ revokeId: '0f8fad5b-d9cb-469f-a165-70867728950e' }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ revoked: false });
    expect(sqlCalls('UPDATE merchant_api_keys')).toHaveLength(1);
  });

  it.each([
    ['a missing name', { permissions: ['read'] }],
    ['a non-string name', { name: 7, permissions: ['read'] }],
    ['a blank name', { name: '', permissions: ['read'] }],
    ['a whitespace-only name', { name: '   ', permissions: ['read'] }],
    ['a name over 120 characters', { name: 'k'.repeat(121), permissions: ['read'] }],
    ['an empty permissions array', { name: 'Store backend', permissions: [] }],
    ['a permission outside read|write|admin', { name: 'Store backend', permissions: ['owner'] }],
    ['a non-string permission', { name: 'Store backend', permissions: ['read', 1] }],
  ])('rejects %s with 400 before inserting', async (_label, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'A name and valid permissions are required' });
    expect(sqlCalls('INSERT INTO merchant_api_keys')).toHaveLength(0);
  });

  it('accepts a name of exactly 120 characters after trimming and stores it trimmed', async () => {
    const name = 'k'.repeat(120);
    const response = await POST(request({ name: `  ${name}  `, permissions: ['admin'] }));

    expect(response.status).toBe(201);
    const [insert] = sqlCalls('INSERT INTO merchant_api_keys');
    expect(insert?.[1]?.[2]).toBe(name);
  });

  it('stores duplicate permissions de-duplicated', async () => {
    const response = await POST(
      request({ name: 'Store backend', permissions: ['read', 'write', 'read', 'write'] }),
    );

    expect(response.status).toBe(201);
    const [insert] = sqlCalls('INSERT INTO merchant_api_keys');
    expect(insert?.[1]?.[5]).toEqual(['read', 'write']);
  });

  it("defaults an omitted permissions field to ['read']", async () => {
    const response = await POST(request({ name: 'Store backend' }));

    expect(response.status).toBe(201);
    const [insert] = sqlCalls('INSERT INTO merchant_api_keys');
    expect(insert?.[1]?.[5]).toEqual(['read']);
  });

  it('marks the 201 response carrying the one-time secret as Cache-Control: no-store', async () => {
    const response = await POST(request({ name: 'Store backend', permissions: ['read'] }));

    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
