import { expect, test, vi, describe, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from './route';

const {
  MERCHANT,
  clientStub,
  mockWithClient,
  mockWithMerchantClient,
  mockGetMerchantFromRequest,
  mockIsAdmin,
  mockGetConfig,
  mockSaveConfig,
} = vi.hoisted(() => {
  const merchant = { id: 7, address: 'GABC' };
  const clientStub = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  return {
    MERCHANT: merchant,
    clientStub,
    mockWithClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(clientStub)),
    mockWithMerchantClient: vi.fn(
      async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) => fn(clientStub),
    ),
    mockGetMerchantFromRequest: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockGetConfig: vi.fn(),
    mockSaveConfig: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  withClient: mockWithClient,
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

vi.mock('@/lib/rbac', () => ({
  isAdmin: mockIsAdmin,
}));

// The config store is stubbed; the real Discord URL validator is kept so the
// route's rejection of non-Discord URLs is exercised for real.
vi.mock('@/lib/notifications/chatNotifier', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications/chatNotifier')>(
    '@/lib/notifications/chatNotifier',
  );
  return {
    ...actual,
    getChatNotifierConfig: mockGetConfig,
    saveChatNotifierConfig: mockSaveConfig,
  };
});

const URL_ = 'http://localhost/api/merchant/settings/notifications';
const VALID_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc-123';
const VALID_WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL';

const STORED = {
  telegramBotToken: 'SECRET-BOT-TOKEN',
  telegramChatId: '-100123',
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/SECRET-WEBHOOK-TOKEN',
  eventFilter: 'all',
};

// The handlers' inferred return type includes `undefined`; a real call never
// returns it, so narrow once here instead of at every assertion.
async function respond(pending: Promise<Response | undefined>): Promise<Response> {
  const res = await pending;
  if (!res) throw new Error('handler returned no response');
  return res;
}

function patch(body: unknown) {
  return respond(
    PATCH(
      new Request(URL_, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    ),
  );
}

async function errorOf(res: Response) {
  expect(res.status).toBe(400);
  return ((await res.json()) as { error: string }).error;
}

describe('/api/merchant/settings/notifications', () => {
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    mockIsAdmin.mockReturnValue(true);
    mockGetMerchantFromRequest.mockResolvedValue(MERCHANT);
    mockGetConfig.mockResolvedValue(STORED);
    mockSaveConfig.mockImplementation(async (_client: unknown, _id: number, update: object) => ({
      ...STORED,
      ...update,
    }));
  });

  afterEach(() => {
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
  });

  describe('GET', () => {
    test('returns the public projection and strips secret material', async () => {
      const res = await respond(GET(new Request(URL_)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        telegramConfigured: true,
        telegramChatId: '-100123',
        discordConfigured: true,
        eventFilter: 'all',
      });
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('SECRET-BOT-TOKEN');
      expect(raw).not.toContain('SECRET-WEBHOOK-TOKEN');
      expect(body).not.toHaveProperty('telegramBotToken');
      expect(body).not.toHaveProperty('discordWebhookUrl');
      expect(mockGetConfig).toHaveBeenCalledWith(clientStub, MERCHANT.id);
    });

    test('returns 500 when DATABASE_URL is not configured', async () => {
      delete process.env.DATABASE_URL;
      const res = await respond(GET(new Request(URL_)));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'DATABASE_URL is not configured' });
      expect(mockGetConfig).not.toHaveBeenCalled();
    });
  });

  describe('PATCH', () => {
    test('returns 500 when DATABASE_URL is not configured', async () => {
      delete process.env.DATABASE_URL;
      const res = await patch({ eventFilter: 'all' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'DATABASE_URL is not configured' });
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a non-JSON body', async () => {
      expect(await errorOf(await patch('not json {'))).toBe('Request body must be JSON');
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a JSON body that is not an object', async () => {
      expect(await errorOf(await patch(['a']))).toBe('Request body must be an object');
      expect(await errorOf(await patch('null'))).toBe('Request body must be an object');
      expect(await errorOf(await patch('"text"'))).toBe('Request body must be an object');
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects an unrecognised key with "Unknown notification setting"', async () => {
      expect(await errorOf(await patch({ eventFilter: 'all', slackWebhook: 'x' }))).toBe(
        'Unknown notification setting',
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a malformed event filter with "Invalid event filter"', async () => {
      expect(await errorOf(await patch({ eventFilter: 'everything' }))).toBe(
        'Invalid event filter',
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a bad Telegram bot token with "Telegram bot token is invalid"', async () => {
      expect(await errorOf(await patch({ telegramBotToken: 'abc' }))).toBe(
        'Telegram bot token is invalid',
      );
      expect(await errorOf(await patch({ telegramBotToken: 12345 }))).toBe(
        'Telegram bot token is invalid',
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a bad Telegram chat ID with "Telegram chat ID is invalid"', async () => {
      expect(await errorOf(await patch({ telegramChatId: 'not a chat' }))).toBe(
        'Telegram chat ID is invalid',
      );
      expect(await errorOf(await patch({ telegramChatId: 42 }))).toBe(
        'Telegram chat ID is invalid',
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('rejects a non-Discord webhook URL with the official-webhook message', async () => {
      expect(await errorOf(await patch({ discordWebhookUrl: 'https://evil.example/hook' }))).toBe(
        'Discord webhook URL must be an official Discord HTTPS webhook',
      );
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    test('persists a valid update and echoes the stored public settings back', async () => {
      const res = await patch({
        telegramBotToken: VALID_TOKEN,
        telegramChatId: '@accensa_ops',
        discordWebhookUrl: VALID_WEBHOOK,
        eventFilter: 'disputes',
      });
      expect(res.status).toBe(200);
      expect(mockSaveConfig).toHaveBeenCalledWith(clientStub, MERCHANT.id, {
        telegramBotToken: VALID_TOKEN,
        telegramChatId: '@accensa_ops',
        discordWebhookUrl: VALID_WEBHOOK,
        eventFilter: 'disputes',
      });
      const body = await res.json();
      expect(body).toEqual({
        telegramConfigured: true,
        telegramChatId: '@accensa_ops',
        discordConfigured: true,
        eventFilter: 'disputes',
      });
      expect(JSON.stringify(body)).not.toContain(VALID_TOKEN);
      expect(JSON.stringify(body)).not.toContain('SECRET');
    });
  });
});
