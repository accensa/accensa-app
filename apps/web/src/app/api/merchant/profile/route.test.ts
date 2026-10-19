import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET, PATCH } from './route';

const {
  MERCHANT,
  clientStub,
  mockWithClient,
  mockWithMerchantClient,
  mockGetMerchantFromRequest,
  mockUpdateMerchantProfile,
  mockGetCachedMerchantFromRequest,
  mockRevalidateTag,
  mockRecordMerchantConfigChange,
} = vi.hoisted(() => {
  const merchant = { id: 1, address: 'GABC' };
  // A minimal postgres client: PATCH also records the config change, whose
  // INSERT and CREATE TABLE run through client.query.
  const clientStub = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  return {
    MERCHANT: merchant,
    clientStub,
    mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(clientStub)),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn(clientStub),
    ),
    mockGetMerchantFromRequest: vi.fn().mockResolvedValue(merchant),
    mockUpdateMerchantProfile: vi.fn(),
    mockGetCachedMerchantFromRequest: vi.fn(),
    mockRevalidateTag: vi.fn(),
    mockRecordMerchantConfigChange: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
  updateMerchantProfile: mockUpdateMerchantProfile,
}));

vi.mock('@/lib/merchant-profile', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/merchant-profile')>('@/lib/merchant-profile');
  return {
    ...actual,
    getCachedMerchantFromRequest: mockGetCachedMerchantFromRequest,
  };
});

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: mockRevalidateTag,
}));

vi.mock('@/lib/merchant-config', () => ({
  recordMerchantConfigChange: mockRecordMerchantConfigChange,
}));

describe('/api/merchant/profile GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 401 when no merchant resolves from the request', async () => {
    mockGetCachedMerchantFromRequest.mockResolvedValue(null);
    const res = await GET(new Request('http://localhost/api/merchant/profile'));
    expect(res.status).toBe(401);
  });

  test('serves the profile from the cached lookup, not a direct DB call', async () => {
    mockGetCachedMerchantFromRequest.mockResolvedValue(MERCHANT);
    const res = await GET(new Request('http://localhost/api/merchant/profile'));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile).toEqual(MERCHANT);
    expect(mockGetCachedMerchantFromRequest).toHaveBeenCalledOnce();
    expect(mockWithClient).not.toHaveBeenCalled();
  });
});

describe('/api/merchant/profile PATCH', () => {
  const patchRequest = (body: unknown, role?: 'admin' | 'viewer') =>
    new Request('http://localhost/api/merchant/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { 'x-accensa-role': role } : {}),
      },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
  });

  test('rejects a non-JSON body', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/merchant/profile', { method: 'PATCH', body: 'nope{' }),
    );
    expect(res.status).toBe(400);
  });

  test('rejects an invalid field before touching the database', async () => {
    const res = await PATCH(patchRequest({ webhookUrl: 'not a url' }));
    expect(res.status).toBe(400);
    expect(mockWithClient).not.toHaveBeenCalled();
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  test('returns 401 when the caller does not resolve to a merchant', async () => {
    mockGetMerchantFromRequest.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ webhookUrl: 'https://merchant.example/hook' }));
    expect(res.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  test('updates the profile scoped to the caller and invalidates its cache tag', async () => {
    const updated = { ...MERCHANT, webhookUrl: 'https://merchant.example/hook' };
    mockUpdateMerchantProfile.mockResolvedValue(updated);

    const res = await PATCH(patchRequest({ webhookUrl: 'https://merchant.example/hook' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile).toEqual(updated);

    expect(mockWithMerchantClient).toHaveBeenCalledWith(MERCHANT.id, expect.any(Function));
    expect(mockUpdateMerchantProfile).toHaveBeenCalledWith(clientStub, MERCHANT.id, {
      webhookUrl: 'https://merchant.example/hook',
    });

    // Immediate expiry, not the stale-while-revalidate 'max' profile - the
    // caller must see its own write on the very next read.
    expect(mockRevalidateTag).toHaveBeenCalledWith(`merchant-profile-${MERCHANT.address}`, {
      expire: 0,
    });
  });

  test("never invalidates another merchant's cache tag", async () => {
    mockUpdateMerchantProfile.mockResolvedValue(MERCHANT);
    await PATCH(patchRequest({ webhookUrl: 'https://merchant.example/hook' }));

    const [tag] = mockRevalidateTag.mock.calls[0];
    expect(tag).toBe(`merchant-profile-${MERCHANT.address}`);
    expect(tag).not.toBe('merchant-profile-someone-else');
  });

  test('rejects a viewer-role PATCH with 403 without modifying the profile or recording history', async () => {
    const res = await PATCH(
      patchRequest({ webhookUrl: 'https://merchant.example/hook' }, 'viewer'),
    );

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('Forbidden: viewer sessions cannot modify merchant settings');
    expect(mockUpdateMerchantProfile).not.toHaveBeenCalled();
    expect(mockRecordMerchantConfigChange).not.toHaveBeenCalled();
  });

  test('validates the request body before evaluating the role guard', async () => {
    const res = await PATCH(patchRequest({ webhookUrl: 'not a url' }, 'viewer'));

    expect(res.status).toBe(400);
    expect(mockUpdateMerchantProfile).not.toHaveBeenCalled();
    expect(mockRecordMerchantConfigChange).not.toHaveBeenCalled();
  });

  test('records an audit history event for each changed profile field when patched by admin', async () => {
    const contractA = `C${'A'.repeat(55)}`;
    const contractB = `C${'B'.repeat(55)}`;
    const updateBody = {
      webhookUrl: 'https://merchant.example/hook',
      refundVaultId: contractA,
      assetContractIds: [contractA, contractB],
    };

    mockUpdateMerchantProfile.mockResolvedValue({
      ...MERCHANT,
      ...updateBody,
    });

    const res = await PATCH(patchRequest(updateBody, 'admin'));

    expect(res.status).toBe(200);
    expect(mockRecordMerchantConfigChange).toHaveBeenCalledTimes(3);
    expect(mockRecordMerchantConfigChange).toHaveBeenCalledWith(clientStub, {
      merchantId: MERCHANT.id,
      field: 'webhookUrl',
      before: null,
      after: 'https://merchant.example/hook',
      source: 'profile_patch',
    });
    expect(mockRecordMerchantConfigChange).toHaveBeenCalledWith(clientStub, {
      merchantId: MERCHANT.id,
      field: 'refundVaultId',
      before: null,
      after: contractA,
      source: 'profile_patch',
    });
    expect(mockRecordMerchantConfigChange).toHaveBeenCalledWith(clientStub, {
      merchantId: MERCHANT.id,
      field: 'assetContractIds',
      before: null,
      after: `${contractA},${contractB}`,
      source: 'profile_patch',
    });
  });
});
