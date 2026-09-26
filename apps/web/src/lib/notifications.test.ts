import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import {
  ensureNotificationSchema,
  listNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  dismissNotification,
  createNotification,
  parseNotificationCategory,
  NOTIFICATION_CATEGORIES,
} from './notifications';

function fakeClient(returning: Record<string, unknown>[] = [], rowCount?: number) {
  const query = vi.fn(async () => ({ rows: returning, rowCount: rowCount ?? returning.length }));
  return { query } as unknown as Client & { query: ReturnType<typeof vi.fn> };
}

const ROW = {
  id: '7',
  category: 'transactions',
  title: 'Payout confirmed',
  body: '100.00 USDC settled to your account.',
  read: false,
  created_at: '2026-09-26T12:00:00.000Z',
  read_at: null,
};

describe('parseNotificationCategory', () => {
  it('accepts every known category', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(parseNotificationCategory(category)).toBe(category);
    }
  });

  it('rejects unknown, non-string, and missing values', () => {
    expect(parseNotificationCategory('marketing')).toBeNull();
    expect(parseNotificationCategory(42)).toBeNull();
    expect(parseNotificationCategory(null)).toBeNull();
    expect(parseNotificationCategory(undefined)).toBeNull();
  });
});

describe('ensureNotificationSchema', () => {
  it('creates the notifications table and both indexes', async () => {
    const client = fakeClient();
    await ensureNotificationSchema(client);

    const sql = client.query.mock.calls.map((c) => c[0]).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(sql).toContain('merchant_id');
    expect(sql).toContain('category');
    expect(sql).toContain('read');
    expect(sql).toContain('idx_notifications_merchant_created');
    expect(sql).toContain('idx_notifications_merchant_unread');
  });
});

describe('listNotifications', () => {
  it('queries by merchant, newest first, with a limit', async () => {
    const client = fakeClient([ROW]);
    const result = await listNotifications(client, 1, 25);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('WHERE merchant_id = $1');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([1, 25]);
    expect(result).toHaveLength(1);
  });

  it('maps a row to the API shape, stringifying the id and dates', async () => {
    const client = fakeClient([ROW]);
    const [notification] = await listNotifications(client, 1);

    expect(notification).toEqual({
      id: 7,
      category: 'transactions',
      title: 'Payout confirmed',
      body: '100.00 USDC settled to your account.',
      read: false,
      created_at: '2026-09-26T12:00:00.000Z',
      read_at: null,
    });
  });

  it('converts Date objects to ISO strings', async () => {
    const client = fakeClient([
      { ...ROW, created_at: new Date('2026-09-26T12:00:00.000Z'), read_at: new Date('2026-09-26T13:00:00.000Z') },
    ]);
    const [notification] = await listNotifications(client, 1);
    expect(notification.created_at).toBe('2026-09-26T12:00:00.000Z');
    expect(notification.read_at).toBe('2026-09-26T13:00:00.000Z');
  });

  it('falls back to the system category for an unrecognized value', async () => {
    const client = fakeClient([{ ...ROW, category: 'marketing' }]);
    const [notification] = await listNotifications(client, 1);
    expect(notification.category).toBe('system');
  });
});

describe('getUnreadNotificationCount', () => {
  it('counts only unread rows for the merchant', async () => {
    const client = fakeClient([{ count: '4' }]);
    const count = await getUnreadNotificationCount(client, 1);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('read = false');
    expect(sql).toContain('WHERE merchant_id = $1');
    expect(params).toEqual([1]);
    expect(count).toBe(4);
  });

  it('returns 0 when the count query comes back empty', async () => {
    const client = fakeClient([]);
    expect(await getUnreadNotificationCount(client, 1)).toBe(0);
  });
});

describe('markAllNotificationsAsRead', () => {
  it('updates only unread rows and reports the number changed', async () => {
    const client = fakeClient([], 3);
    const { updated } = await markAllNotificationsAsRead(client, 1);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('SET read = true, read_at = now()');
    expect(sql).toContain('WHERE merchant_id = $1 AND read = false');
    expect(params).toEqual([1]);
    expect(updated).toBe(3);
  });
});

describe('markNotificationAsRead', () => {
  it('scopes the update to the merchant and the single id', async () => {
    const client = fakeClient([], 1);
    const updated = await markNotificationAsRead(client, 1, 7);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('WHERE merchant_id = $1 AND id = $2 AND read = false');
    expect(params).toEqual([1, 7]);
    expect(updated).toBe(true);
  });

  it('returns false when nothing matched (already read or wrong merchant)', async () => {
    const client = fakeClient([], 0);
    expect(await markNotificationAsRead(client, 1, 7)).toBe(false);
  });
});

describe('dismissNotification', () => {
  it('deletes the row scoped to the merchant', async () => {
    const client = fakeClient([], 1);
    const dismissed = await dismissNotification(client, 1, 7);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('DELETE FROM notifications WHERE merchant_id = $1 AND id = $2');
    expect(params).toEqual([1, 7]);
    expect(dismissed).toBe(true);
  });

  it('returns false when no row was removed', async () => {
    const client = fakeClient([], 0);
    expect(await dismissNotification(client, 1, 999)).toBe(false);
  });
});

describe('createNotification', () => {
  it('inserts and returns the mapped notification', async () => {
    const client = fakeClient([ROW]);
    const notification = await createNotification(
      client,
      1,
      'security',
      'New sign-in',
      'A new device signed in to your account.',
    );

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO notifications');
    expect(params).toEqual([1, 'security', 'New sign-in', 'A new device signed in to your account.']);
    expect(notification.id).toBe(7);
    expect(notification.category).toBe('security');
  });
});
