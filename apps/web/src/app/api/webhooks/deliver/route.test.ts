import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { withClient, ensureSchema } from '@/lib/db';
import { deliverDue, pendingDue } from '@/lib/webhooks';
import { deliverDueChatNotifications } from '@/lib/notifications/chatNotifier';

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(),
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/webhooks', () => ({
  deliverDue: vi.fn(),
  pendingDue: vi.fn(),
}));

vi.mock('@/lib/notifications/chatNotifier', () => ({
  deliverDueChatNotifications: vi.fn(),
}));

describe('GET /api/webhooks/deliver', () => {
  const originalEnv = { ...process.env };
  const stubClient = { query: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

    vi.mocked(withClient).mockImplementation(async (callback) => {
      return callback(stubClient as unknown as Parameters<typeof callback>[0]);
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('answers 401 and never calls withClient when bearer token is wrong', async () => {
    const request = new Request('http://test/api/webhooks/deliver', {
      headers: { authorization: 'Bearer wrong-secret' },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(withClient).not.toHaveBeenCalled();
  });

  it('answers 500 when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const request = new Request('http://test/api/webhooks/deliver', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'DATABASE_URL is not configured' });
    expect(withClient).not.toHaveBeenCalled();
  });

  it('returns success: true with delivery outcome, chat result, and lag merged', async () => {
    vi.mocked(ensureSchema).mockResolvedValue(undefined as never);
    vi.mocked(deliverDue).mockResolvedValue({ delivered: 3, failed: 0 } as never);
    vi.mocked(deliverDueChatNotifications).mockResolvedValue({ sent: 1, failed: 0 } as never);
    vi.mocked(pendingDue).mockResolvedValue(2 as never);

    const request = new Request('http://test/api/webhooks/deliver', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      delivered: 3,
      failed: 0,
      chat: { sent: 1, failed: 0 },
      lag: 2,
    });
    expect(withClient).toHaveBeenCalledTimes(1);
    expect(ensureSchema).toHaveBeenCalledWith(stubClient);
    expect(deliverDue).toHaveBeenCalledWith(stubClient);
    expect(deliverDueChatNotifications).toHaveBeenCalledWith(stubClient);
    expect(pendingDue).toHaveBeenCalledWith(stubClient);
  });

  it('answers a generic 500 when delivery throws a failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(withClient).mockRejectedValue(new Error('Postgres connection lost'));

    const request = new Request('http://test/api/webhooks/deliver', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Internal Server Error',
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
