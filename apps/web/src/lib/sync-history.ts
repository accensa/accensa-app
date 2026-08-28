/**
 * Sync History Pagination (#150).
 *
 * Provides paginated access to the sync history stored in the merchant's
 * sync state, with cursor-based pagination for efficient scrolling through
 * large histories.
 *
 * Usage:
 *   import { getSyncHistory } from '@/lib/sync-history';
 *
 *   const history = await getSyncHistory(client, merchantId, {
 *     limit: 20,
 *     cursor: 'ledger:12345',
 *   });
 */

import type { PostgresClient } from './db';

export interface SyncHistoryEntry {
  ledger: number;
  syncedAt: string;
  paymentsInserted: number;
  durationMs: number;
}

export interface SyncHistoryPage {
  entries: SyncHistoryEntry[];
  nextCursor: string | null;
  totalCount: number;
}

/**
 * Parse a sync history cursor into a ledger number.
 */
function parseCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  const match = cursor.match(/^ledger:(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Create a cursor from a ledger number.
 */
function createCursor(ledger: number): string {
  return `ledger:${ledger}`;
}

/**
 * Get paginated sync history for a merchant.
 *
 * The sync history is derived from the sync_events table which stores
 * each completed sync run with its metadata.
 */
export async function getSyncHistory(
  client: PostgresClient,
  merchantId: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<SyncHistoryPage> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const afterLedger = parseCursor(opts.cursor ?? null);

  // Ensure the sync_events table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_events (
      id SERIAL PRIMARY KEY,
      merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      ledger INTEGER NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payments_inserted INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sync_events_merchant_ledger
      ON sync_events(merchant_id, ledger DESC);
  `);

  // Get total count
  const countResult = await client.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM sync_events WHERE merchant_id = $1`,
    [merchantId],
  );
  const totalCount = parseInt(countResult.rows[0]?.total ?? '0', 10);

  // Get page of entries
  let query = `
    SELECT ledger, synced_at, payments_inserted, duration_ms
    FROM sync_events
    WHERE merchant_id = $1
  `;
  const params: (string | number)[] = [merchantId];

  if (afterLedger !== null) {
    query += ` AND ledger < $${params.length + 1}`;
    params.push(afterLedger);
  }

  query += ` ORDER BY ledger DESC LIMIT $${params.length + 1}`;
  params.push(limit + 1); // Fetch one extra to detect next page

  const result = await client.query<{
    ledger: number;
    synced_at: Date;
    payments_inserted: number;
    duration_ms: number;
  }>(query, params);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const entries = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
    ledger: row.ledger,
    syncedAt: row.synced_at instanceof Date ? row.synced_at.toISOString() : String(row.synced_at),
    paymentsInserted: row.payments_inserted,
    durationMs: row.duration_ms,
  }));

  const nextCursor = hasMore && entries.length > 0
    ? createCursor(entries[entries.length - 1].ledger)
    : null;

  return { entries, nextCursor, totalCount };
}

/**
 * Record a sync event in the history.
 */
export async function recordSyncEvent(
  client: PostgresClient,
  merchantId: string,
  ledger: number,
  paymentsInserted: number,
  durationMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_events (merchant_id, ledger, payments_inserted, duration_ms)
     VALUES ($1, $2, $3, $4)`,
    [merchantId, ledger, paymentsInserted, durationMs],
  );
}
