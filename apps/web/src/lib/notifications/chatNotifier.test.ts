import { describe, expect, it, vi } from 'vitest';
import {
  acceptsChatEvent,
  dispatchChatNotification,
  deliverDueChatNotifications,
  enqueueChatNotifications,
  formatDiscordNotification,
  formatTelegramNotification,
  isValidDiscordWebhookUrl,
  type ChatNotificationPayload,
} from './chatNotifier';

const payload: ChatNotificationPayload = {
  event: 'settlement',
  amount: '12.50',
  asset: 'USDC',
  customerAddress: 'GABC<unsafe>&',
  txHash: 'a'.repeat(64),
};

describe('chat notifications', () => {
  it('formats escaped Telegram HTML with amount, customer, and explorer link', () => {
    const message = formatTelegramNotification(payload);
    expect(message.text).toContain('12.50 USDC');
    expect(message.text).toContain('GABC&lt;unsafe&gt;&amp;');
    expect(message.text).toContain(`https://stellar.expert/explorer/testnet/tx/${'a'.repeat(64)}`);
  });

  it('formats a Discord embed without including any extra payment data', () => {
    const message = formatDiscordNotification(payload);
    expect(message.embeds[0].fields).toEqual([
      { name: 'Amount', value: '12.50 USDC', inline: true },
      { name: 'Customer address', value: 'GABC<unsafe>&', inline: false },
      {
        name: 'Transaction',
        value: `[View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/${'a'.repeat(64)})`,
        inline: false,
      },
    ]);
  });

  it('allows only Discord webhook destinations on the official HTTPS hosts', () => {
    expect(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/123/secret-token')).toBe(
      true,
    );
    expect(isValidDiscordWebhookUrl('https://example.com/api/webhooks/123/secret-token')).toBe(
      false,
    );
    expect(isValidDiscordWebhookUrl('http://discord.com/api/webhooks/123/secret-token')).toBe(
      false,
    );
  });

  it('filters settlement and dispute events explicitly', () => {
    expect(acceptsChatEvent('settlements', 'settlement')).toBe(true);
    expect(acceptsChatEvent('settlements', 'dispute')).toBe(false);
    expect(acceptsChatEvent('disputes', 'dispute')).toBe(true);
    expect(acceptsChatEvent('all', 'dispute')).toBe(true);
  });

  it('dispatches a test payload to the configured Telegram API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await dispatchChatNotification(
      'telegram',
      {
        telegramBotToken: 'token',
        telegramChatId: 'chat',
        discordWebhookUrl: null,
        eventFilter: 'all',
      },
      payload,
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.telegram.org/bottoken/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).chat_id).toBe('chat');
  });

  it('queues only events that match the merchant filter and fans out to configured platforms', async () => {
    let insertSql = '';
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT telegram_bot_token')) {
          return {
            rows: [
              {
                telegram_bot_token: 'token',
                telegram_chat_id: 'chat',
                discord_webhook_url: 'https://discord.com/api/webhooks/123/secret',
                event_filter: 'settlements',
              },
            ],
          };
        }
        insertSql = sql;
        return { rowCount: 2, rows: [] };
      }),
    } as never;

    const queued = await enqueueChatNotifications(client, 9, [
      payload,
      { ...payload, event: 'dispute', txHash: 'b'.repeat(64) },
    ]);

    expect(queued).toBe(2);
    expect(insertSql).toContain('INSERT INTO chat_notification_outbox');
    expect(insertSql).toContain('ON CONFLICT');
  });

  it('sends due outbox rows in the worker and marks successful deliveries', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT id, merchant_id, platform')) {
          return {
            rows: [{ id: '4', merchant_id: 9, platform: 'telegram', payload, attempts: 0 }],
          };
        }
        if (sql.includes('SELECT telegram_bot_token')) {
          return {
            rows: [
              {
                telegram_bot_token: 'token',
                telegram_chat_id: 'chat',
                discord_webhook_url: null,
                event_filter: 'all',
              },
            ],
          };
        }
        return { rowCount: 1, rows: [{ id: '4' }] };
      }),
    } as never;
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const outcome = await deliverDueChatNotifications(client, {
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(outcome).toEqual({ attempted: 1, delivered: 1, failed: 0, retried: 0 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(statements.some((sql) => sql.includes("status = 'delivered'"))).toBe(true);
  });
});
