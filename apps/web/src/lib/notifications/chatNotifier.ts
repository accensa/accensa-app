import type { Client } from 'pg';

export type ChatPlatform = 'telegram' | 'discord';
export type ChatEvent = 'settlement' | 'dispute';
export type ChatEventFilter = 'settlements' | 'disputes' | 'all';

export interface ChatNotificationPayload {
  event: ChatEvent;
  amount: string;
  asset: string;
  customerAddress: string;
  txHash: string;
  explorerUrl?: string;
}

export interface ChatNotifierConfig {
  telegramBotToken: string | null;
  telegramChatId: string | null;
  discordWebhookUrl: string | null;
  eventFilter: ChatEventFilter;
}

export interface ChatNotifierUpdate {
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  discordWebhookUrl?: string | null;
  eventFilter?: ChatEventFilter;
}

export async function ensureChatNotifierSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_chat_notifiers (
      merchant_id INT PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
      telegram_bot_token TEXT,
      telegram_chat_id TEXT,
      discord_webhook_url TEXT,
      event_filter VARCHAR(16) NOT NULL DEFAULT 'all',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (event_filter IN ('settlements', 'disputes', 'all'))
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS chat_notification_outbox (
      id BIGSERIAL PRIMARY KEY,
      merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      platform VARCHAR(12) NOT NULL CHECK (platform IN ('telegram', 'discord')),
      event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('settlement', 'dispute')),
      dedupe_key VARCHAR(128) NOT NULL,
      payload JSONB NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      delivered_at TIMESTAMPTZ,
      UNIQUE (merchant_id, platform, event_type, dedupe_key)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_notification_outbox_due
     ON chat_notification_outbox (available_at, id) WHERE status = 'pending';`,
  );
}

export async function getChatNotifierConfig(
  client: Client,
  merchantId: number,
): Promise<ChatNotifierConfig> {
  const result = await client.query<{
    telegram_bot_token: string | null;
    telegram_chat_id: string | null;
    discord_webhook_url: string | null;
    event_filter: string;
  }>(
    `SELECT telegram_bot_token, telegram_chat_id, discord_webhook_url, event_filter
     FROM merchant_chat_notifiers WHERE merchant_id = $1`,
    [merchantId],
  );
  const row = result.rows[0];
  return {
    telegramBotToken: row?.telegram_bot_token ?? null,
    telegramChatId: row?.telegram_chat_id ?? null,
    discordWebhookUrl: row?.discord_webhook_url ?? null,
    eventFilter:
      row?.event_filter === 'settlements' || row?.event_filter === 'disputes'
        ? row.event_filter
        : 'all',
  };
}

export async function saveChatNotifierConfig(
  client: Client,
  merchantId: number,
  update: ChatNotifierUpdate,
): Promise<ChatNotifierConfig> {
  const current = await getChatNotifierConfig(client, merchantId);
  const next = {
    telegramBotToken:
      update.telegramBotToken === undefined ? current.telegramBotToken : update.telegramBotToken,
    telegramChatId:
      update.telegramChatId === undefined ? current.telegramChatId : update.telegramChatId,
    discordWebhookUrl:
      update.discordWebhookUrl === undefined ? current.discordWebhookUrl : update.discordWebhookUrl,
    eventFilter: update.eventFilter ?? current.eventFilter,
  };
  await client.query(
    `INSERT INTO merchant_chat_notifiers
       (merchant_id, telegram_bot_token, telegram_chat_id, discord_webhook_url, event_filter, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (merchant_id) DO UPDATE SET
       telegram_bot_token = EXCLUDED.telegram_bot_token,
       telegram_chat_id = EXCLUDED.telegram_chat_id,
       discord_webhook_url = EXCLUDED.discord_webhook_url,
       event_filter = EXCLUDED.event_filter,
       updated_at = now()`,
    [
      merchantId,
      next.telegramBotToken,
      next.telegramChatId,
      next.discordWebhookUrl,
      next.eventFilter,
    ],
  );
  return next;
}

export async function enqueueChatNotification(
  client: Client,
  merchantId: number,
  payload: ChatNotificationPayload,
  dedupeKey = payload.txHash,
): Promise<number> {
  return enqueueChatNotifications(client, merchantId, [payload], dedupeKey);
}

export async function enqueueChatNotifications(
  client: Client,
  merchantId: number,
  payloads: ChatNotificationPayload[],
  dedupeKeyOverride?: string,
): Promise<number> {
  const config = await getChatNotifierConfig(client, merchantId);
  const platforms: ChatPlatform[] = [];
  if (config.telegramBotToken && config.telegramChatId) platforms.push('telegram');
  if (config.discordWebhookUrl) platforms.push('discord');
  if (!platforms.length) return 0;

  const eligible = payloads.filter((payload) =>
    acceptsChatEvent(config.eventFilter, payload.event),
  );
  if (!eligible.length) return 0;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const payload of eligible) {
    for (const platform of platforms) {
      const base = values.length;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`);
      values.push(
        merchantId,
        platform,
        payload.event,
        dedupeKeyOverride ?? payload.txHash,
        JSON.stringify(payload),
      );
    }
  }
  const result = await client.query(
    `INSERT INTO chat_notification_outbox
       (merchant_id, platform, event_type, dedupe_key, payload)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (merchant_id, platform, event_type, dedupe_key) DO NOTHING`,
    values,
  );
  return result.rowCount ?? 0;
}

export async function deliverDueChatNotifications(
  client: Client,
  options: { fetchImpl?: typeof fetch; now?: Date; timeoutMs?: number } = {},
): Promise<{ attempted: number; delivered: number; failed: number; retried: number }> {
  const now = options.now ?? new Date();
  const result = { attempted: 0, delivered: 0, failed: 0, retried: 0 };
  const due = await client.query<{
    id: string;
    merchant_id: number;
    platform: ChatPlatform;
    payload: ChatNotificationPayload;
    attempts: number;
  }>(
    `SELECT id, merchant_id, platform, payload, attempts
     FROM chat_notification_outbox
     WHERE status = 'pending' AND available_at <= $1
    ORDER BY available_at, id LIMIT 10`,
    [now],
  );

  for (const row of due.rows) {
    const claimed = await client.query(
      `UPDATE chat_notification_outbox SET status = 'delivering'
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [row.id],
    );
    if (!claimed.rowCount) continue;
    result.attempted++;
    try {
      const config = await getChatNotifierConfig(client, row.merchant_id);
      await dispatchChatNotification(row.platform, config, row.payload, options.fetchImpl);
      await client.query(
        `UPDATE chat_notification_outbox SET status = 'delivered', attempts = attempts + 1,
           delivered_at = $2, last_error = NULL WHERE id = $1`,
        [row.id, now],
      );
      result.delivered++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const terminal = attempts >= 8;
      const delaySeconds = Math.min(3600, 2 ** attempts * 30);
      await client.query(
        `UPDATE chat_notification_outbox SET status = $2, attempts = $3,
           available_at = $4::timestamptz + ($5 * interval '1 second'), last_error = $6
         WHERE id = $1`,
        [
          row.id,
          terminal ? 'failed' : 'pending',
          attempts,
          now,
          delaySeconds,
          error instanceof Error ? error.message.slice(0, 500) : 'Notification delivery failed',
        ],
      );
      if (terminal) result.failed++;
      else result.retried++;
    }
  }
  return result;
}

export function acceptsChatEvent(filter: ChatEventFilter, event: ChatEvent): boolean {
  return (
    filter === 'all' ||
    (filter === 'settlements' && event === 'settlement') ||
    (filter === 'disputes' && event === 'dispute')
  );
}

export function isValidDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['discord.com', 'discordapp.com'].includes(url.hostname) &&
      /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function explorerUrl(payload: ChatNotificationPayload): string {
  if (
    payload.explorerUrl &&
    /^https:\/\/stellar\.expert\/explorer\/(mainnet|testnet)\/tx\/[a-f0-9]{64}$/i.test(
      payload.explorerUrl,
    )
  ) {
    return payload.explorerUrl;
  }
  return `https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(payload.txHash)}`;
}

export function formatTelegramNotification(payload: ChatNotificationPayload) {
  const dispute = payload.event === 'dispute';
  const title = dispute ? 'Customer dispute filed' : 'Payment received';
  return {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text: [
      `<b>${title}</b>`,
      `Amount: ${escapeHtml(payload.amount)} ${escapeHtml(payload.asset)}`,
      `Customer: <code>${escapeHtml(payload.customerAddress)}</code>`,
      `<a href="${explorerUrl(payload)}">View transaction</a>`,
    ].join('\n'),
  };
}

export function formatDiscordNotification(payload: ChatNotificationPayload) {
  const dispute = payload.event === 'dispute';
  return {
    embeds: [
      {
        title: dispute ? 'Customer dispute filed' : 'Payment received',
        color: dispute ? 0xe05252 : 0x159570,
        url: explorerUrl(payload),
        fields: [
          { name: 'Amount', value: `${payload.amount} ${payload.asset}`, inline: true },
          {
            name: 'Customer address',
            value: payload.customerAddress || 'Unavailable',
            inline: false,
          },
          {
            name: 'Transaction',
            value: `[View on Stellar Expert](${explorerUrl(payload)})`,
            inline: false,
          },
        ],
      },
    ],
  };
}

export function formatChatNotification(platform: ChatPlatform, payload: ChatNotificationPayload) {
  return platform === 'telegram'
    ? formatTelegramNotification(payload)
    : formatDiscordNotification(payload);
}

export async function dispatchChatNotification(
  platform: ChatPlatform,
  config: ChatNotifierConfig,
  payload: ChatNotificationPayload,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  let url: string;
  if (platform === 'telegram') {
    if (!config.telegramBotToken || !config.telegramChatId)
      throw new Error('Telegram is not configured');
    url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  } else {
    if (!config.discordWebhookUrl || !isValidDiscordWebhookUrl(config.discordWebhookUrl)) {
      throw new Error('Discord webhook URL is invalid');
    }
    url = config.discordWebhookUrl;
  }

  const body = formatChatNotification(platform, payload);
  if (platform === 'telegram') {
    Object.assign(body, { chat_id: config.telegramChatId });
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok)
    throw new Error(`${platform} notification failed with status ${response.status}`);
}
