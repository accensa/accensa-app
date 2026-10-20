import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './route';

const { mockWithClient, mockEnsureSchema, mockLoadUnanchored } = vi.hoisted(() => ({
  mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  mockEnsureSchema: vi.fn(),
  mockLoadUnanchored: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  ensureSchema: mockEnsureSchema,
}));

vi.mock('@/lib/anchor', () => ({
  buildPreview: vi.fn(),
  loadUnanchored: mockLoadUnanchored,
  persistPreview: vi.fn(),
  MAX_BATCH_SIZE: 64,
}));

vi.mock('@/lib/receipt-anchor', () => ({
  RECEIPT_ANCHOR_ID: 'C123456789ABCDEFG',
}));

const request = (query = '') =>
  new Request(`http://localhost/api/anchor/preview${query ? `?${query}` : ''}`);

describe('/api/anchor/preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
    process.env.MERCHANT_ADDRESS = 'GABC';
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
    mockWithClient.mockImplementation(async (fn) => fn({}));
    mockLoadUnanchored.mockResolvedValue([]);
  });

  test('returns 500 when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL;

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'DATABASE_URL is not configured' });
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  test('returns 500 when MERCHANT_ADDRESS is not configured', async () => {
    delete process.env.MERCHANT_ADDRESS;

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'MERCHANT_ADDRESS is not configured' });
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  test.each([
    ['abc', 'fromLedger must be a whole number'],
    ['0', 'fromLedger must be a positive integer'],
    ['-1', 'fromLedger must be a whole number'],
    ['9007199254740992', 'fromLedger must be a positive integer'],
  ])('returns 400 for fromLedger=%s', async (ledger, error) => {
    const response = await GET(request(`fromLedger=${encodeURIComponent(ledger)}`));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(mockWithClient).not.toHaveBeenCalled();
  });

  test('returns the signing-prompt fields for a valid empty range', async () => {
    const response = await GET(request('fromLedger=10&toLedger=20'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      count: 0,
      merchant: 'GABC',
      contractId: 'C123456789ABCDEFG',
      networkPassphrase: 'Test SDF Network ; September 2015',
      maxBatchSize: 64,
    });
    expect(mockLoadUnanchored).toHaveBeenCalledWith({}, { fromLedger: 10, toLedger: 20 });
  });

  test('returns 500 when the database-backed preview fails', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockWithClient.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal Server Error' });
    logError.mockRestore();
  });
});
