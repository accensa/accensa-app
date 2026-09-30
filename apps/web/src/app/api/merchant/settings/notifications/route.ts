import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';
import {
  getChatNotifierConfig,
  isValidDiscordWebhookUrl,
  saveChatNotifierConfig,
  type ChatEventFilter,
  type ChatNotifierUpdate,
} from '@/lib/notifications/chatNotifier';

export const dynamic = 'force-dynamic';

async function resolveAdminMerchant(request: Request) {
  if (!isAdmin(request))
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const merchant = await withClient(async (client) => {
    await ensureSchema(client);
    return getMerchantFromRequest(client, request);
  });
  if (!merchant) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { merchant };
}

function toPublicSettings(config: Awaited<ReturnType<typeof getChatNotifierConfig>>) {
  return {
    telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
    telegramChatId: config.telegramChatId,
    discordConfigured: Boolean(config.discordWebhookUrl),
    eventFilter: config.eventFilter,
  };
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  const resolved = await resolveAdminMerchant(request);
  if ('response' in resolved) return resolved.response;
  const config = await withMerchantClient(resolved.merchant.id, (client) =>
    getChatNotifierConfig(client, resolved.merchant.id),
  );
  return NextResponse.json(toPublicSettings(config));
}

export async function PATCH(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  const resolved = await resolveAdminMerchant(request);
  if ('response' in resolved) return resolved.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set([
    'telegramBotToken',
    'telegramChatId',
    'discordWebhookUrl',
    'eventFilter',
    'clearTelegram',
    'clearDiscord',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return NextResponse.json({ error: 'Unknown notification setting' }, { status: 400 });
  }

  const update: ChatNotifierUpdate = {};
  if (input.eventFilter !== undefined) {
    if (!['settlements', 'disputes', 'all'].includes(String(input.eventFilter))) {
      return NextResponse.json({ error: 'Invalid event filter' }, { status: 400 });
    }
    update.eventFilter = input.eventFilter as ChatEventFilter;
  }
  if (input.telegramBotToken !== undefined && input.telegramBotToken !== '') {
    if (
      typeof input.telegramBotToken !== 'string' ||
      !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(input.telegramBotToken)
    ) {
      return NextResponse.json({ error: 'Telegram bot token is invalid' }, { status: 400 });
    }
    update.telegramBotToken = input.telegramBotToken;
  }
  if (input.telegramChatId !== undefined) {
    if (
      typeof input.telegramChatId !== 'string' ||
      !/^-?\d{1,24}$|^@[A-Za-z0-9_]{5,32}$/.test(input.telegramChatId)
    ) {
      return NextResponse.json({ error: 'Telegram chat ID is invalid' }, { status: 400 });
    }
    update.telegramChatId = input.telegramChatId;
  }
  if (input.discordWebhookUrl !== undefined && input.discordWebhookUrl !== '') {
    if (
      typeof input.discordWebhookUrl !== 'string' ||
      !isValidDiscordWebhookUrl(input.discordWebhookUrl)
    ) {
      return NextResponse.json(
        { error: 'Discord webhook URL must be an official Discord HTTPS webhook' },
        { status: 400 },
      );
    }
    update.discordWebhookUrl = input.discordWebhookUrl;
  }
  if (input.clearTelegram === true) {
    update.telegramBotToken = null;
    update.telegramChatId = null;
  }
  if (input.clearDiscord === true) update.discordWebhookUrl = null;

  const config = await withMerchantClient(resolved.merchant.id, (client) =>
    saveChatNotifierConfig(client, resolved.merchant.id, update),
  );
  return NextResponse.json(toPublicSettings(config));
}
