import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetMerchantByAddress, mockUnstableCache } = vi.hoisted(() => ({
  mockGetMerchantByAddress: vi.fn(),
  // A pass-through fake: calls the wrapped function on every invocation, so
  // tests exercise `getCachedMerchantByAddress`'s own logic without needing a
  // real Next.js cache runtime.
  mockUnstableCache: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

vi.mock('./db', () => ({
  withClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('./merchants', () => ({
  getMerchantByAddress: mockGetMerchantByAddress,
}));

vi.mock('next/cache', () => ({
  unstable_cache: mockUnstableCache,
}));

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const KEY_HEX = 'a'.repeat(64);

describe('merchantProfileCacheTag', () => {
  it('scopes the tag by address', async () => {
    const { merchantProfileCacheTag } = await import('./merchant-profile');
    expect(merchantProfileCacheTag('GABC')).toBe('merchant-profile-GABC');
    expect(merchantProfileCacheTag('GABC')).not.toBe(merchantProfileCacheTag('GXYZ'));
  });
});

describe('getCachedMerchantByAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps the DB lookup with unstable_cache, tagged for this merchant', async () => {
    const { getCachedMerchantByAddress, merchantProfileCacheTag } =
      await import('./merchant-profile');
    const merchant = { id: 1, address: 'GABC' };
    mockGetMerchantByAddress.mockResolvedValue(merchant);

    const result = await getCachedMerchantByAddress('GABC');

    expect(result).toEqual(merchant);
    expect(mockGetMerchantByAddress).toHaveBeenCalledWith({}, 'GABC');
    expect(mockUnstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      ['merchant-profile', 'GABC'],
      { tags: [merchantProfileCacheTag('GABC')] },
    );
  });
});

describe('getCachedMerchantFromRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when the trusted merchant header is missing', async () => {
    const { getCachedMerchantFromRequest } = await import('./merchant-profile');
    const result = await getCachedMerchantFromRequest(new Request('http://localhost/'));
    expect(result).toBeNull();
    expect(mockGetMerchantByAddress).not.toHaveBeenCalled();
  });

  it('resolves the merchant named by x-accensa-merchant', async () => {
    const { getCachedMerchantFromRequest } = await import('./merchant-profile');
    const merchant = { id: 1, address: 'GABC' };
    mockGetMerchantByAddress.mockResolvedValue(merchant);

    const result = await getCachedMerchantFromRequest(
      new Request('http://localhost/', { headers: { 'x-accensa-merchant': 'GABC' } }),
    );

    expect(result).toEqual(merchant);
    expect(mockGetMerchantByAddress).toHaveBeenCalledWith({}, 'GABC');
  });
});

describe('parseMerchantProfileUpdate', () => {
  it('accepts an empty object (no-op update)', async () => {
    const { parseMerchantProfileUpdate } = await import('./merchant-profile');
    expect(parseMerchantProfileUpdate({})).toEqual({ ok: true, update: {} });
  });

  it('rejects a non-object body', async () => {
    const { parseMerchantProfileUpdate } = await import('./merchant-profile');
    expect(parseMerchantProfileUpdate(null)).toEqual({
      ok: false,
      error: 'Body must be a JSON object',
    });
    expect(parseMerchantProfileUpdate([1, 2]).ok).toBe(false);
    expect(parseMerchantProfileUpdate('nope').ok).toBe(false);
  });

  describe('publicKeyHex', () => {
    it('accepts a valid hex-encoded 32-byte key, lowercased', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      const result = parseMerchantProfileUpdate({ publicKeyHex: KEY_HEX.toUpperCase() });
      expect(result).toEqual({ ok: true, update: { publicKeyHex: KEY_HEX } });
    });

    it('accepts null to clear it', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ publicKeyHex: null })).toEqual({
        ok: true,
        update: { publicKeyHex: null },
      });
    });

    it('rejects the wrong length', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      const result = parseMerchantProfileUpdate({ publicKeyHex: 'a'.repeat(63) });
      expect(result.ok).toBe(false);
    });

    it('rejects a non-string', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ publicKeyHex: 123 }).ok).toBe(false);
    });
  });

  describe('assetContractIds', () => {
    it('accepts an array of valid contract IDs', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      const result = parseMerchantProfileUpdate({ assetContractIds: [CONTRACT_ID] });
      expect(result).toEqual({ ok: true, update: { assetContractIds: [CONTRACT_ID] } });
    });

    it('accepts null to clear it', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ assetContractIds: null })).toEqual({
        ok: true,
        update: { assetContractIds: null },
      });
    });

    it('rejects a non-array', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ assetContractIds: CONTRACT_ID }).ok).toBe(false);
    });

    it('rejects an array containing an invalid contract ID', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ assetContractIds: [CONTRACT_ID, 'not-a-cid'] }).ok).toBe(
        false,
      );
    });
  });

  describe('refundVaultId', () => {
    it('accepts a valid contract ID', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      const result = parseMerchantProfileUpdate({ refundVaultId: CONTRACT_ID });
      expect(result).toEqual({ ok: true, update: { refundVaultId: CONTRACT_ID } });
    });

    it('rejects a Stellar account ID (G-address) here - this field wants a contract', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ refundVaultId: 'G' + 'A'.repeat(55) }).ok).toBe(false);
    });
  });

  describe('webhookUrl', () => {
    it('accepts a valid https URL', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      const result = parseMerchantProfileUpdate({ webhookUrl: 'https://merchant.example/hook' });
      expect(result).toEqual({
        ok: true,
        update: { webhookUrl: 'https://merchant.example/hook' },
      });
    });

    it('accepts null to clear it', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ webhookUrl: null })).toEqual({
        ok: true,
        update: { webhookUrl: null },
      });
    });

    it('rejects a non-http(s) scheme', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ webhookUrl: 'ftp://merchant.example' }).ok).toBe(false);
    });

    it('rejects an unparsable URL', async () => {
      const { parseMerchantProfileUpdate } = await import('./merchant-profile');
      expect(parseMerchantProfileUpdate({ webhookUrl: 'not a url' }).ok).toBe(false);
    });
  });

  it('validates multiple fields in one call and reports the first failure', async () => {
    const { parseMerchantProfileUpdate } = await import('./merchant-profile');
    const result = parseMerchantProfileUpdate({
      publicKeyHex: KEY_HEX,
      webhookUrl: 'not a url',
    });
    expect(result.ok).toBe(false);
  });
});
