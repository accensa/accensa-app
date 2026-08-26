import { expect, test, vi, describe, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { GET } from './route';

const MERCHANT_KEYPAIR = Keypair.random();
const MERCHANT_ADDRESS = MERCHANT_KEYPAIR.publicKey();

const {
  mockStoreNonce,
  mockSweepExpiredNonces,
  mockEnsureSchema,
  mockWithClient,
  mockGetMerchantByAddress,
} = vi.hoisted(() => ({
  mockStoreNonce: vi.fn().mockResolvedValue(undefined),
  mockSweepExpiredNonces: vi.fn().mockResolvedValue(undefined),
  mockEnsureSchema: vi.fn().mockResolvedValue(undefined),
  mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => {
    return fn({});
  }),
  mockGetMerchantByAddress: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  ensureSchema: mockEnsureSchema,
  storeNonce: mockStoreNonce,
  sweepExpiredNonces: mockSweepExpiredNonces,
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantByAddress: mockGetMerchantByAddress,
}));

describe('/api/auth/challenge GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantByAddress.mockImplementation(async (_client: unknown, address: string) =>
      address === MERCHANT_ADDRESS ? { id: 1, address: MERCHANT_ADDRESS } : null,
    );
  });

  const mockRequest = (address: string | null) =>
    new Request(
      `http://localhost/api/auth/challenge${address ? `?address=${encodeURIComponent(address)}` : ''}`,
    );

  test('returns xdr and configured network passphrase', async () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
    const res = await GET(mockRequest(MERCHANT_ADDRESS));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.xdr).toBeDefined();
    expect(typeof data.xdr).toBe('string');
    expect(data.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
  });

  test('defaults to Networks.TESTNET when STELLAR_NETWORK_PASSPHRASE is unset', async () => {
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    const res = await GET(mockRequest(MERCHANT_ADDRESS));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  test('persists the nonce scoped to the resolved merchant', async () => {
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    const res = await GET(mockRequest(MERCHANT_ADDRESS));
    expect(res.status).toBe(200);
    expect(mockStoreNonce).toHaveBeenCalledTimes(1);
    const [, nonceArg, merchantIdArg] = mockStoreNonce.mock.calls[0];
    expect(nonceArg).toMatch(/^[0-9a-f]{64}$/);
    expect(merchantIdArg).toBe(1);
    expect(mockSweepExpiredNonces).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when address query parameter is missing', async () => {
    const res = await GET(mockRequest(null));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('address query parameter is required');
  });

  test('returns 404 for an address with no matching merchant', async () => {
    const res = await GET(mockRequest(Keypair.random().publicKey()));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Unknown merchant');
  });
});
