import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

/**
 * Guard order in `route.ts` (verified by reading the file, not by the issue
 * text, which listed the DATABASE_URL guard before the admin check):
 *
 *   1. `isAdmin(request)`            -> 403 Forbidden
 *   2. missing `DATABASE_URL`        -> 500 DATABASE_URL is not configured
 *   3. platform validation (try)     -> 400 Platform must be telegram or discord
 *      (the `throw new Error()` above is caught by the enclosing `catch`)
 *   4. `getMerchantFromRequest` null -> 401 Unauthorized
 *   5. `dispatchChatNotification`
 *        resolves                    -> 200 { success: true }
 *        rejects                     -> 502 { error }
 *
 * Every test below therefore reaches its branch with the guards above it
 * already satisfied. The 502 test deliberately keeps a valid configuration
 * (DATABASE_URL set, admin and merchant resolved) so the 502 is attributable
 * to the provider rejection and not to the configuration 500.
 */

const mocks = vi.hoisted(() => ({
  withClient: vi.fn(),
  withMerchantClient: vi.fn(),
  getMerchantFromRequest: vi.fn(),
  isAdmin: vi.fn(),
  getChatNotifierConfig: vi.fn(),
  dispatchChatNotification: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: mocks.withClient,
  withMerchantClient: mocks.withMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantFromRequest: mocks.getMerchantFromRequest }));
vi.mock('@/lib/rbac', () => ({ isAdmin: mocks.isAdmin }));
// The provider client is stubbed at the module boundary, the same way
// api/webhooks/[id]/route.test.ts stubs `@/lib/webhooks`, so no test can
// reach Telegram or Discord and no bot token is required.
vi.mock('@/lib/notifications/chatNotifier', () => ({
  getChatNotifierConfig: mocks.getChatNotifierConfig,
  dispatchChatNotification: mocks.dispatchChatNotification,
}));

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function post(body: BodyInit, contentType = 'application/json') {
  return new Request('https://accensa.test/api/merchant/settings/notifications/test', {
    method: 'POST',
    body,
    headers: { 'Content-Type': contentType },
  });
}

const validBody = JSON.stringify({ platform: 'telegram' });

describe('POST /api/merchant/settings/notifications/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mocks.isAdmin.mockReturnValue(true);
    mocks.withClient.mockImplementation(async (callback) => callback({}));
    mocks.withMerchantClient.mockImplementation(async (_merchantId, callback) => callback({}));
    mocks.getMerchantFromRequest.mockResolvedValue({ id: 4 });
    mocks.getChatNotifierConfig.mockResolvedValue({
      telegramBotToken: 'bot-token',
      telegramChatId: 'chat-id',
      discordWebhookUrl: null,
      eventFilter: 'all',
    });
    mocks.dispatchChatNotification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreEnv('DATABASE_URL', ORIGINAL_DATABASE_URL);
    vi.restoreAllMocks();
  });

  it('returns 400 when the platform is missing', async () => {
    const response = await POST(post(JSON.stringify({})));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Platform must be telegram or discord' });
    expect(mocks.dispatchChatNotification).not.toHaveBeenCalled();
  });

  it('returns 400 when the platform is an unknown string', async () => {
    const response = await POST(post(JSON.stringify({ platform: 'slack' })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Platform must be telegram or discord' });
    expect(mocks.dispatchChatNotification).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not JSON', async () => {
    const response = await POST(post('this is not json', 'text/plain'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Platform must be telegram or discord' });
    expect(mocks.dispatchChatNotification).not.toHaveBeenCalled();
  });

  it('returns 401 when the merchant cannot be resolved', async () => {
    mocks.getMerchantFromRequest.mockResolvedValue(null);

    const response = await POST(post(validBody));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
    expect(mocks.dispatchChatNotification).not.toHaveBeenCalled();
  });

  it('returns 500 when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL;

    const response = await POST(post(validBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'DATABASE_URL is not configured' });
    expect(mocks.withClient).not.toHaveBeenCalled();
    expect(mocks.dispatchChatNotification).not.toHaveBeenCalled();
  });

  it('returns exactly { success: true } when the provider send resolves', async () => {
    // A sentinel the route must ignore: nothing from the provider's return
    // value may leak into the response body.
    mocks.dispatchChatNotification.mockResolvedValue({
      id: 'provider-receipt-1',
      delivered: true,
    });

    const response = await POST(post(validBody));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(Object.keys(body)).toEqual(['success']);
    expect(mocks.dispatchChatNotification).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ telegramBotToken: 'bot-token' }),
      expect.objectContaining({ event: 'settlement' }),
    );
  });

  it('returns 502 when the provider send rejects even with a valid configuration', async () => {
    mocks.dispatchChatNotification.mockRejectedValue(
      new Error('telegram notification failed with status 500'),
    );

    const response = await POST(post(validBody));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'telegram notification failed with status 500',
    });
    // Proves the request was fully configured: the merchant row was read, so
    // the 502 did not come from the DATABASE_URL 500 branch.
    expect(mocks.withClient).toHaveBeenCalled();
    expect(mocks.withMerchantClient).toHaveBeenCalled();
  });
});
