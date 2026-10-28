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

  function post(payload: unknown, raw = false) {
    return POST(
      new Request('http://localhost/api/anchor/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw ? (payload as string) : JSON.stringify(payload),
      }),
    );
  }

  it('rejects a non-JSON body with 400', async () => {
    const response = await post('nope{', true);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be JSON' });
  });

  it('rejects a JSON non-object body with 400', async () => {
    const response = await post([body]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be a JSON object' });
  });

  it('rejects a malformed root with its own 400 message', async () => {
    const response = await post({ ...body, root: 'not-a-hash' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'root must be a 32-byte hex hash' });
    expect(mocks.recordAnchoredBatch).not.toHaveBeenCalled();
  });

  it('rejects a malformed anchorTx with its own 400 message', async () => {
    const response = await post({ ...body, anchorTx: 'zz' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'anchorTx must be a 32-byte hex hash' });
  });

  it('rejects a malformed batchId with its own 400 message', async () => {
    const response = await post({ ...body, batchId: 0 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'batchId must be a positive integer' });
  });

  it('returns 502 when the ledger read fails and does not write a record', async () => {
    mocks.getBatch.mockRejectedValue(new Error('rpc down'));

    const response = await post(body);
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toContain('retry recording without submitting again');
    expect(mocks.recordAnchoredBatch).toHaveBeenCalledTimes(0);
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
  });

  it('accepts a root that differs only by hex case and refuses a different root with 409', async () => {
    mocks.getBatch.mockResolvedValue({ root: body.root.toUpperCase() });
    const accepted = await post(body);
    expect(accepted.status).toBe(200);
    expect(mocks.recordAnchoredBatch).toHaveBeenCalledTimes(1);

    mocks.recordAnchoredBatch.mockClear();
    mocks.getBatch.mockResolvedValue({ root: 'a'.repeat(64) });
    const refused = await post(body);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: 'On-chain root does not match the previewed tree; refusing to record',
    });
    expect(mocks.recordAnchoredBatch).toHaveBeenCalledTimes(0);
  });

  it('replays the same selection as a no-op and returns the first record', async () => {
    let writes = 0;
    const existing = { batchId: body.batchId, alreadyRecorded: false, status: 'recorded' as const };
    mocks.recordAnchoredBatch.mockImplementation(async () => {
      if (writes > 0) return { ...existing, alreadyRecorded: true };
      writes += 1;
      return existing;
    });

    const first = await post(body);
    const second = await post(body);

    expect(await first.json()).toMatchObject({
      success: true,
      batchId: body.batchId,
      alreadyRecorded: false,
    });
    expect(await second.json()).toMatchObject({
      success: true,
      batchId: body.batchId,
      alreadyRecorded: true,
    });
    // The route asks the helper again; the helper's write path runs once and
    // the replay returns the record from the first call.
    expect(writes).toBe(1);
  });
});
