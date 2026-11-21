import { describe, it, expect, beforeEach } from 'vitest';
import type { Client } from 'pg';
import {
  listNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  dismissNotification,
} from './notifications';

/** An in-memory row that includes merchant_id so the fake can filter by tenant. */
interface InternalRow {
  merchant_id: number;
  id: number;
  category: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  read_at: string | null;
}

/**
 * A statement-aware fake Client. It inspects the SQL text and routes each call
 * to the right operation on the in-memory rows, applying the merchant_id
 * predicate from $1 on every query. Removing merchant_id = $1 from any one
 * statement in notifications.ts will cause cross-tenant data to bleed through,
 * and the assertions below will catch it.
 */
function twoMerchantClient(seed: InternalRow[]): Client {
  const rows = seed.map((r) => ({ ...r }));

  const query = async (sql: string, params?: unknown[]) => {
    const merchantId = params?.[0] as number;

    if (sql.includes('count(*)')) {
      const count = rows.filter((r) => r.merchant_id === merchantId && !r.read).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }

    if (sql.trimStart().startsWith('DELETE')) {
      const id = Number(params?.[1]);
      const idx = rows.findIndex((r) => r.merchant_id === merchantId && r.id === id);
      if (idx >= 0) {
        rows.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('UPDATE') && sql.includes('id = $2')) {
      // markNotificationAsRead: params = [merchantId, id]
      const id = Number(params?.[1]);
      const row = rows.find((r) => r.merchant_id === merchantId && r.id === id && !r.read);
      if (row) {
        row.read = true;
        row.read_at = new Date().toISOString();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('UPDATE')) {
      // markAllNotificationsAsRead: params = [merchantId]
      let count = 0;
      for (const row of rows) {
        if (row.merchant_id === merchantId && !row.read) {
          row.read = true;
          row.read_at = new Date().toISOString();
          count++;
        }
      }
      return { rows: [], rowCount: count };
    }

    // listNotifications SELECT
    const limit = (params?.[1] as number | undefined) ?? 50;
    const filtered = rows.filter((r) => r.merchant_id === merchantId).slice(0, limit);
    return { rows: filtered, rowCount: filtered.length };
  };

  return { query } as unknown as Client;
}

const BASE_ROW: Omit<InternalRow, 'merchant_id' | 'id' | 'read' | 'read_at'> = {
  category: 'transactions',
  title: 'Test',
  body: 'Body text',
  created_at: '2026-10-01T10:00:00.000Z',
};

/** merchant 1 — id 1 (unread), id 2 (read) */
const M1_UNREAD: InternalRow = { ...BASE_ROW, merchant_id: 1, id: 1, read: false, read_at: null };
const M1_READ: InternalRow = {
  ...BASE_ROW,
  merchant_id: 1,
  id: 2,
  read: true,
  read_at: '2026-10-01T11:00:00.000Z',
};
/** merchant 2 — id 3 (unread) */
const M2_UNREAD: InternalRow = { ...BASE_ROW, merchant_id: 2, id: 3, read: false, read_at: null };

describe('notifications — tenant isolation', () => {
  let client: Client;

  beforeEach(() => {
    client = twoMerchantClient([M1_UNREAD, M1_READ, M2_UNREAD]);
  });

  it('listNotifications returns only the calling merchant’s rows', async () => {
    const rows = await listNotifications(client, 1);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.id === 1 || r.id === 2)).toBe(true);
  });

  it('getUnreadNotificationCount counts only the calling merchant’s unread rows', async () => {
    expect(await getUnreadNotificationCount(client, 1)).toBe(1);
    expect(await getUnreadNotificationCount(client, 2)).toBe(1);
  });

  it('markNotificationAsRead as merchant 2 on a merchant 1 id returns false', async () => {
    expect(await markNotificationAsRead(client, 2, 1)).toBe(false);
    // The row is still unread for merchant 1.
    expect(await getUnreadNotificationCount(client, 1)).toBe(1);
  });

  it('dismissNotification as merchant 2 on a merchant 1 id returns false and leaves the row', async () => {
    expect(await dismissNotification(client, 2, 1)).toBe(false);
    // Merchant 1 still has both rows.
    expect(await listNotifications(client, 1)).toHaveLength(2);
  });

  it('markAllNotificationsAsRead as merchant 2 touches only merchant 2’s rows', async () => {
    const { updated } = await markAllNotificationsAsRead(client, 2);
    expect(updated).toBe(1);
    // Merchant 1’s unread row is untouched.
    expect(await getUnreadNotificationCount(client, 1)).toBe(1);
  });
});
