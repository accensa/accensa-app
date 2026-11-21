import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { withClient, ensureSchema } from './db';
import {
  createNotification,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from './notifications';
import { getMerchantByAddress } from './merchants';

let merchantId: number;
const hex = randomBytes(8).toString('hex').toUpperCase();
const TEST_ADDRESS = `GTEST${hex}`.padEnd(56, 'X').slice(0, 56);

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;

  await withClient(async (client) => {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
      [TEST_ADDRESS],
    );
  });

  const merchant = await withClient((client) => getMerchantByAddress(client, TEST_ADDRESS));
  if (!merchant) throw new Error('Could not create test merchant for mark-all-read test');
  merchantId = merchant.id;
});

describe('markAllNotificationsAsRead (integration)', () => {
  it('marks unread rows; keeps read_at on already-read rows; second call: updated 0', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping mark-all-read integration test: DATABASE_URL not set');
      return;
    }

    await withClient(async (client) => {
      // Start from a clean slate for this merchant
      await client.query('DELETE FROM notifications WHERE merchant_id = $1', [merchantId]);

      // Three unread notifications
      for (let i = 0; i < 3; i++) {
        await createNotification(client, merchantId, 'transactions', `Unread ${i}`, 'body');
      }

      // Two pre-read notifications: create then mark as read
      const r1 = await createNotification(client, merchantId, 'system', 'Already read 1', 'body');
      const r2 = await createNotification(client, merchantId, 'system', 'Already read 2', 'body');
      await markNotificationAsRead(client, merchantId, r1.id);
      await markNotificationAsRead(client, merchantId, r2.id);

      // Capture read_at of the already-read rows before the bulk call
      const beforeRes = await client.query<{ id: string; read_at: string }>(
        `SELECT id, read_at FROM notifications
         WHERE merchant_id = $1 AND read = true
         ORDER BY id`,
        [merchantId],
      );
      expect(beforeRes.rows).toHaveLength(2);
      const beforeMap = new Map(beforeRes.rows.map((r) => [r.id, r.read_at]));

      // First call: should mark the three unread rows
      const first = await markAllNotificationsAsRead(client, merchantId);
      expect(first).toEqual({ updated: 3 });

      // Both previously-read rows must keep their original read_at (not slide forward)
      const afterRes = await client.query<{ id: string; read_at: string }>(
        `SELECT id, read_at FROM notifications
         WHERE merchant_id = $1 AND id = ANY($2::bigint[])`,
        [merchantId, [...beforeMap.keys()]],
      );
      for (const row of afterRes.rows) {
        expect(new Date(row.read_at).toISOString()).toBe(
          new Date(beforeMap.get(row.id)!).toISOString(),
        );
      }

      // Second call: nothing left unread, so updated must be 0
      const second = await markAllNotificationsAsRead(client, merchantId);
      expect(second).toEqual({ updated: 0 });
    });
  });
});
