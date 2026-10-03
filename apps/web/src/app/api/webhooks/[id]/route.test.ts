import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  withClient: vi.fn(),
  withMerchantClient: vi.fn(),
  getMerchantFromRequest: vi.fn(),
  isAdmin: vi.fn(),
  requeueFailedDelivery: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mocks.withClient,
  withMerchantClient: mocks.withMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mocks.getMerchantFromRequest }));
vi.mock('@/lib/rbac', () => ({ isAdmin: mocks.isAdmin }));
vi.mock('@/lib/webhooks', () => ({ requeueFailedDelivery: mocks.requeueFailedDelivery }));

describe('POST /api/webhooks/[id]', () => {
  const request = () => new Request('http://localhost/api/webhooks/12', { method: 'POST' });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    process.env.WEBHOOK_URL = 'https://merchant.example/hook';
    mocks.isAdmin.mockReturnValue(true);
    mocks.withClient.mockImplementation(async (callback) => callback({}));
    mocks.withMerchantClient.mockImplementation(async (_merchantId, callback) => callback({}));
    mocks.getMerchantFromRequest.mockResolvedValue({ id: 4 });
    mocks.requeueFailedDelivery.mockResolvedValue(true);
  });

  it('rejects malformed delivery IDs', async () => {
    const response = await POST(request(), params('not-a-number'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Delivery ID must be a positive integer' });
  });

  it('denies viewers before querying delivery data', async () => {
    mocks.isAdmin.mockReturnValue(false);
    const response = await POST(request(), params('12'));
    expect(response.status).toBe(403);
    expect(mocks.withClient).not.toHaveBeenCalled();
  });

  it('queues an eligible failure for its owning merchant', async () => {
    const response = await POST(request(), params('12'));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true, id: 12 });
    expect(mocks.requeueFailedDelivery).toHaveBeenCalledWith({}, 12, 4);
  });

  it('returns a conflict when the delivery is not retryable', async () => {
    mocks.requeueFailedDelivery.mockResolvedValue(false);
    const response = await POST(request(), params('12'));
    expect(response.status).toBe(409);
  });
});