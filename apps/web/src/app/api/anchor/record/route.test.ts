import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  withClient: vi.fn(),
  withMerchantClient: vi.fn(),
  getMerchantFromRequest: vi.fn(),
  recordAnchoredBatch: vi.fn(),
  getBatch: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mocks.withClient,
  withMerchantClient: mocks.withMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mocks.getMerchantFromRequest }));
vi.mock('@/lib/anchor', () => ({ recordAnchoredBatch: mocks.recordAnchoredBatch }));
vi.mock('@/lib/receipt-anchor', () => ({
  getBatch: mocks.getBatch,
  isHash32: (value: string) => /^[0-9a-f]{64}$/i.test(value),
}));

describe('POST /api/anchor/record', () => {
  const body = {
    selectionHash: '1'.repeat(64),
    root: '2'.repeat(64),
    anchorTx: '3'.repeat(64),
    batchId: 11,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mocks.withClient.mockImplementation(async (callback) => callback({}));
    mocks.withMerchantClient.mockImplementation(async (_merchantId, callback) => callback({}));
    mocks.getMerchantFromRequest.mockResolvedValue({ id: 41, address: 'GTEST' });
    mocks.getBatch.mockResolvedValue({ root: body.root });
    mocks.recordAnchoredBatch.mockResolvedValue({
      batchId: body.batchId,
      alreadyRecorded: false,
      status: 'recorded',
    });
  });

  it('resolves the session merchant and scopes anchor writes to it', async () => {
    const response = await POST(
      new Request('http://localhost/api/anchor/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.withMerchantClient).toHaveBeenCalledWith(41, expect.any(Function));
    expect(mocks.recordAnchoredBatch).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ merchantId: 41 }),
    );
  });

  it('rejects a request without an authenticated merchant', async () => {
    mocks.getMerchantFromRequest.mockResolvedValue(null);

    const response = await POST(
      new Request('http://localhost/api/anchor/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
    expect(mocks.getBatch).not.toHaveBeenCalled();
  });
});
