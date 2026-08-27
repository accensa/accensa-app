import type { Client } from 'pg';
import { setLastSyncedLedger } from './db';
import { decodeTransferEvent, type RawEvent } from './stellar-events';

/**
 * Rows per INSERT statement.
 *
 * Each row binds 7 parameters, so a batch of 100 binds 700 — two orders of
 * magnitude below Postgres's 65,535-parameter ceiling per statement. The
 * statement stays small enough for any pooler or proxy to handle comfortably,
 * and a 10,000-event catch-up goes from 10,000 round trips to 100.
 */
export const PAYMENTS_BATCH_SIZE = 100;

/**
 * Maps raw RPC events to insertable payment rows for one merchant.
 *
 * The per-event filtering lives here, where a test can pin it down: a
 * malformed or non-transfer event is skipped, and a transfer not addressed to
 * this merchant is never recorded. Batching must not quietly admit events that
 * would have been filtered out — this is the only place rows are produced, and
 * the batched insert consumes exactly what this returns.
 *
 * @returns The rows to insert, and how many events decoded (including
 *   skipped ones), mirroring the route's old per-event accounting.
 */
export function eventsToPaymentRows(
  events: RawEvent[],
  merchant: { id: number; address: string },
): { rows: PaymentRow[]; decoded: number } {
  const rows: PaymentRow[] = [];
  let decoded = 0;
  for (const event of events) {
    const transferEvent = decodeTransferEvent(event);
    // A malformed or non-transfer event must not stall the batch.
    if (!transferEvent) continue;
    decoded++;
    // Defensive: never record a transfer that is not to this merchant.
    if (transferEvent.to !== merchant.address) continue;
    rows.push({
      merchantId: merchant.id,
      txHash: transferEvent.txHash,
      ledger: transferEvent.ledger,
      payer: transferEvent.from,
      amount: transferEvent.amount, // string - never a float
      asset: transferEvent.asset,
      ts: transferEvent.ledgerClosedAt,
    });
  }
  return { rows, decoded };
}

/** One decoded, merchant-addressed transfer, ready to be inserted. */
export interface PaymentRow {
  merchantId: number;
  txHash: string;
  ledger: number;
  payer: string;
  amount: string;
  asset: string;
  /** ISO 8601 ledger close time. */
  ts: string;
}

/** Splits rows into `size`-sized chunks; the last chunk may be smaller. */
export function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * Builds one multi-row INSERT for `rowCount` payments.
 *
 * `ON CONFLICT (merchant_id, tx_hash) DO UPDATE ... WHERE payments.ledger IS
 * NULL` is preserved verbatim from the per-row statement it replaces: a row may
 * already exist because the merchant reported route attribution before this
 * transfer was indexed, and only ledger-owned columns may be written — route,
 * method, request_id and hook_reported_at belong to the merchant's report and
 * are left alone. `RETURNING *` yields exactly the rows actually written, which
 * is what the webhook path needs.
 */
export function buildBatchInsertSql(rowCount: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i * 7;
    tuples.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::numeric, $${base + 6}, $${base + 7}::timestamptz)`,
    );
  }
  return `INSERT INTO payments (merchant_id, tx_hash, ledger, payer, amount, asset, ts)
  VALUES ${tuples.join(', ')}
  ON CONFLICT (merchant_id, tx_hash) DO UPDATE
  SET ledger = EXCLUDED.ledger,
  payer = EXCLUDED.payer,
  amount = EXCLUDED.amount,
  asset = EXCLUDED.asset,
  ts = EXCLUDED.ts
  WHERE payments.ledger IS NULL RETURNING *`;
}

/** Flattens rows into the bind-parameter list `buildBatchInsertSql` expects. */
export function flattenRows(rows: PaymentRow[]): unknown[] {
  const params: unknown[] = [];
  for (const r of rows) {
    params.push(r.merchantId, r.txHash, r.ledger, r.payer, r.amount, r.asset, r.ts);
  }
  return params;
}

/**
 * Inserts `rows` in batches, then advances the sync cursor — atomically.
 *
 * The whole run — every batch plus the cursor write — happens inside one
 * transaction, so either all of it commits or none of it does:
 *
 * - If a chunk fails mid-run, the ROLLBACK discards every batch written so far
 *   and the cursor is never advanced, so `syncedTo` never passes a ledger whose
 *   rows failed to commit. A contiguous cursor is a property this project
 *   actively monitors.
 * - Webhooks are *not* fired here: they run after COMMIT in the caller, so a
 *   slow webhook can never hold the transaction open, and a webhook failure
 *   cannot roll back a committed batch.
 *
 * @returns The rows RETURNING produced — exactly the payments inserted or
 *   updated by this run (conflicts skipped by the `WHERE ledger IS NULL` guard
 *   are not returned, matching the old per-row `rowCount` semantics).
 */
export async function insertPaymentsInTransaction(
  client: Client,
  merchantId: number,
  rows: PaymentRow[],
  sweptThrough: number,
): Promise<{ inserted: number; payments: Record<string, unknown>[] }> {
  await client.query('BEGIN');
  try {
    const payments: Record<string, unknown>[] = [];
    for (const chunk of chunkRows(rows, PAYMENTS_BATCH_SIZE)) {
      const res = await client.query<Record<string, unknown>>(
        buildBatchInsertSql(chunk.length),
        flattenRows(chunk),
      );
      payments.push(...res.rows);
    }
    // The cursor advances inside the same transaction, so it can never move
    // past uncommitted rows — and the advisory lock in setLastSyncedLedger
    // now actually serializes concurrent runs for this merchant, since it is
    // held until COMMIT rather than released at statement end.
    await setLastSyncedLedger(client, merchantId, sweptThrough);
    await client.query('COMMIT');
    return { inserted: payments.length, payments };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
