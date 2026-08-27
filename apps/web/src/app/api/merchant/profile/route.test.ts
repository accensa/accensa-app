import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET, PATCH } from './route';

const {
  MERCHANT,
  mockWithClient,
  mockWithMerchantClient,
  mockGetMerchantFromRequest,
  mockUpdateMerchantProfile,
  mockGetCachedMerchantFromRequest,
  mockRevalidateTag,
} = vi.hoisted(() => {
  const merchant = { id: 1, address: 'GABC' };
  return {
    MERCHANT: merchant,
    mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn({}),
    ),
    mockGetMerchantFromRequest: vi.fn().mockResolvedValue(merchant),
    mockUpdateMerchantProfile: vi.fn(),
    mockGetCachedMerchantFromRequest: vi.fn(),
    mockRevalidateTag: vi.fn(),
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
  const patchRequest = (body: unknown) =>
    new Request('http://localhost/api/merchant/profile', {
      method: 'PATCH',
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
    expect(mockUpdateMerchantProfile).toHaveBeenCalledWith({}, MERCHANT.id, {
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
});
