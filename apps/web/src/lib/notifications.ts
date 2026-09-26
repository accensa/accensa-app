import type { Client } from 'pg';

/**
 * Notification categories shown in the merchant portal's notification center.
 *
 * The drawer groups every notification under one of these four buckets, so a
 * merchant can scan "Security" without wading through payout confirmations.
 */
export type NotificationCategory = 'transactions' | 'disputes' | 'security' | 'system';

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'transactions',
  'disputes',
  'security',
  'system',
];

/** Parses a category claim, rejecting anything that is not a known category. */
export function parseNotificationCategory(value: unknown): NotificationCategory | null {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
    ? (value as NotificationCategory)
    : null;
}

/** A notification as `/api/notifications` returns it. */
export interface Notification {
  id: number;
  category: NotificationCategory;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  read_at: string | null;
}

/** The list response: the merchant's notifications plus the live unread count. */
export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

interface NotificationRow {
  id: string;
  category: string;
  title: string;
  body: string;
  read: boolean;
  created_at: Date | string;
  read_at: Date | string | null;
}

function fromRow(row: NotificationRow): Notification {
  return {
    id: Number(row.id),
    category: parseNotificationCategory(row.category) ?? 'system',
    title: row.title,
    body: row.body,
    read: row.read,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    read_at:
      row.read_at == null
        ? null
        : row.read_at instanceof Date
          ? row.read_at.toISOString()
          : String(row.read_at),
  };
}

/**
 * Creates the notifications table if it does not exist.
 *
 * Follows the same defensive pattern as `ensureSchema` in `lib/db.ts`: every
 * DB-touching handler calls this first, so a fresh database works without a
 * manual migration step. Rows are scoped by `merchant_id` and every query the
 * API issues carries that predicate, matching the tenant isolation the
 * payments and sync_state tables already enforce.
 */
export async function ensureNotificationSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      merchant_id INT NOT NULL REFERENCES merchants(id),
      category VARCHAR(20) NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_notifications_merchant_created
     ON notifications (merchant_id, created_at DESC);`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_notifications_merchant_unread
     ON notifications (merchant_id, read) WHERE read = false;`,
  );
}

/**
 * Lists a merchant's notifications, newest first.
 *
 * `read` is deliberately not a filter: the drawer shows read and unread
 * together so a merchant can revisit a payout confirmation, and the unread
 * state is carried per row (plus aggregated in `unreadCount`).
 */
export async function listNotifications(
  client: Client,
  merchantId: number,
  limit = 50,
): Promise<Notification[]> {
  const res = await client.query<NotificationRow>(
    `SELECT id, category, title, body, read, created_at, read_at
     FROM notifications
     WHERE merchant_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [merchantId, limit],
  );
  return res.rows.map(fromRow);
}

/** How many unread notifications the merchant has; drives the bell badge. */
export async function getUnreadNotificationCount(
  client: Client,
  merchantId: number,
): Promise<number> {
  const res = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM notifications
     WHERE merchant_id = $1 AND read = false`,
    [merchantId],
  );
  return res.rows.length ? Number(res.rows[0].count ?? 0) : 0;
}

/**
 * Marks every one of the merchant's unread notifications as read.
 *
 * Returns how many rows changed, so the API can report the effect instead of
 * leaving the client to infer it. Already-read rows are untouched, so
 * `read_at` keeps the time of the *first* read rather than sliding forward
 * every time the merchant clears the badge.
 */
export async function markAllNotificationsAsRead(
  client: Client,
  merchantId: number,
): Promise<{ updated: number }> {
  const res = await client.query(
    `UPDATE notifications
     SET read = true, read_at = now()
     WHERE merchant_id = $1 AND read = false`,
    [merchantId],
  );
  return { updated: res.rowCount ?? 0 };
}

/**
 * Marks a single notification as read, scoped to the merchant so one tenant
 * can never mutate another's row.
 *
 * Returns true when the notification existed for this merchant and was
 * unread; false when it was already read or does not belong to the caller.
 */
export async function markNotificationAsRead(
  client: Client,
  merchantId: number,
  id: number,
): Promise<boolean> {
  const res = await client.query(
    `UPDATE notifications
     SET read = true, read_at = now()
     WHERE merchant_id = $1 AND id = $2 AND read = false`,
    [merchantId, id],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Dismisses (deletes) a single notification, scoped to the merchant.
 *
 * Dismissal is a delete rather than a flag: a dismissed notification is gone
 * from the drawer, and keeping the row around would let the table grow
 * without bound for a merchant who clears the same alerts every day.
 *
 * Returns true when a row was removed.
 */
export async function dismissNotification(
  client: Client,
  merchantId: number,
  id: number,
): Promise<boolean> {
  const res = await client.query(
    `DELETE FROM notifications WHERE merchant_id = $1 AND id = $2`,
    [merchantId, id],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Inserts a notification for a merchant.
 *
 * The portal itself has no write path yet — announcements, dispute updates,
 * payout confirmations, and security alerts are produced by the indexer and
 * sync pipeline — but the insert is what those producers call, and it lets
 * tests seed a merchant's drawer without a live chain.
 */
export async function createNotification(
  client: Client,
  merchantId: number,
  category: NotificationCategory,
  title: string,
  body: string,
): Promise<Notification> {
  const res = await client.query<NotificationRow>(
    `INSERT INTO notifications (merchant_id, category, title, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, category, title, body, read, created_at, read_at`,
    [merchantId, category, title, body],
  );
  return fromRow(res.rows[0]);
}
