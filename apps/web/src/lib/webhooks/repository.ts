import type { Client } from 'pg';
import { logger } from '../log.ts';
import { WebhookDeliveryError } from './errors.ts';
import { canonicalPayload } from './payload.ts';
import type { DueDeliveryRow, PaymentPayload } from './types.ts';

/**
 * Every `webhook_deliveries` / `webhook_attempts` statement in one place, so
 * the delivery policy and the transport stay free of SQL. Signatures and error
 * texts are unchanged from the pre-#350 single-file module.
 */

export async function enqueueWebhookDelivery(
  client: Client,
  payment: PaymentPayload,
  url: string,
): Promise<void> {
  const body = canonicalPayload(payment);
  try {
    await client.query(
      `INSERT INTO webhook_deliveries (payment_tx_hash, url, payload, status, next_retry_at)
       VALUES ($1, $2, $3::jsonb, 'pending', now())
       ON CONFLICT (payment_tx_hash, url) DO NOTHING`,
      [payment.tx_hash, url, body],
    );
    logger.info('Webhook delivery enqueued', { tx_hash: payment.tx_hash, url });
  } catch (e) {
    logger.error('Failed to enqueue webhook delivery', {
      tx_hash: payment.tx_hash,
      url,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError(
      `Failed to enqueue webhook delivery for ${payment.tx_hash}`,
      undefined,
      true,
    );
  }
}

export async function resetStaleDelivering(client: Client): Promise<void> {
  try {
    await client.query(
      `UPDATE webhook_deliveries
       SET status = 'pending', updated_at = now()
       WHERE status = 'delivering' AND updated_at < now() - interval '1 minute'`,
    );
  } catch (e) {
    logger.error('Failed to reset delivering deliveries', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError('Failed to reset delivering deliveries', undefined, true);
  }
}

export async function fetchDueDeliveries(client: Client, now: Date): Promise<DueDeliveryRow[]> {
  try {
    const due = await client.query<DueDeliveryRow>(
      `SELECT id, payment_tx_hash, url, payload, attempts, created_at
       FROM webhook_deliveries
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= $1)
       ORDER BY next_retry_at NULLS FIRST, id ASC
       LIMIT 50`,
      [now],
    );
    return due.rows;
  } catch (e) {
    logger.error('Failed to fetch due deliveries', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError('Failed to fetch due deliveries', undefined, true);
  }
}

/**
 * Claim one due row for this worker. Returns false when another worker got
 * there first (or the claim itself failed) — a failed claim never aborts the
 * batch, matching the pre-#350 behaviour.
 */
export async function claimDelivery(client: Client, row: DueDeliveryRow): Promise<boolean> {
  try {
    const take = await client.query(
      `UPDATE webhook_deliveries SET status = 'delivering', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [row.id],
    );
    return (take.rowCount ?? 0) > 0;
  } catch (e) {
    logger.error('Failed to claim delivery', {
      id: row.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function requeueUnsent(client: Client, id: string): Promise<void> {
  try {
    await client.query(
      `UPDATE webhook_deliveries SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'delivering'`,
      [id],
    );
  } catch (e) {
    logger.error('Failed to reset deadline-exceeded delivery', {
      id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function persistAttempt(input: {
  client: Client;
  id: number;
  attemptNumber: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  status: string;
  next: Date | null;
}): Promise<void> {
  await input.client.query(
    `INSERT INTO webhook_attempts (delivery_id, attempt_number, status_code, error, duration_ms)
       VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.attemptNumber, input.statusCode, input.error, input.durationMs],
  );

  await input.client.query(
    `UPDATE webhook_deliveries
       SET status = $2,
           attempts = $3,
           last_status_code = $4,
           last_error = $5,
           next_retry_at = $6,
           delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
           updated_at = now()
       WHERE id = $1`,
    [input.id, input.status, input.attemptNumber, input.statusCode, input.error, input.next],
  );
}

export async function pendingDue(
  client: Client,
  opts: { now?: Date; merchantId?: number } = {},
): Promise<number> {
  try {
    const now = (opts.now ?? new Date()).toISOString();
    const merchantScope =
      opts.merchantId === undefined
        ? ''
        : `AND EXISTS (
             SELECT 1 FROM payments p
             WHERE p.tx_hash = webhook_deliveries.payment_tx_hash AND p.merchant_id = $2
           )`;
    const res = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM webhook_deliveries
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= $1::timestamptz)
         ${merchantScope}`,
      opts.merchantId === undefined ? [now] : [now, opts.merchantId],
    );
    const count = Number(res.rows[0]?.count ?? 0);
    logger.debug('Pending due count retrieved', { count });
    return count;
  } catch (e) {
    logger.error('Failed to get pending due count', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError('Failed to get pending due count', undefined, true);
  }
}

export async function fetchStatusCounts(
  client: Client,
  merchantId: number,
): Promise<{ status: string; n: string }[]> {
  const counts = await client.query<{ status: string; n: string }>(
    `SELECT d.status, count(*)::text AS n
       FROM webhook_deliveries d
       JOIN payments p ON p.tx_hash = d.payment_tx_hash AND p.merchant_id = $1
       GROUP BY d.status`,
    [merchantId],
  );
  return counts.rows;
}

export interface RecentFailureRow {
  id: string;
  payment_tx_hash: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  updated_at: Date;
}

export async function fetchRecentFailures(
  client: Client,
  merchantId: number,
): Promise<RecentFailureRow[]> {
  const recent = await client.query<RecentFailureRow>(
    `SELECT d.id, d.payment_tx_hash, d.status, d.attempts, d.last_status_code, d.last_error, d.updated_at
        FROM webhook_deliveries d
        JOIN payments p ON p.tx_hash = d.payment_tx_hash AND p.merchant_id = $1
        WHERE d.status IN ('failed', 'dead_letter')
        ORDER BY d.updated_at DESC
        LIMIT 20`,
    [merchantId],
  );
  return recent.rows;
}

export interface DeliveryLogRow {
  id: string;
  payment_tx_hash: string;
  payload: PaymentPayload;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  attempt_history: Array<{
    attemptNumber: number;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
    createdAt: Date | string;
  }>;
}

export async function fetchRecentDeliveries(
  client: Client,
  merchantId: number,
): Promise<DeliveryLogRow[]> {
  const result = await client.query<DeliveryLogRow>(
    `SELECT d.id, d.payment_tx_hash, d.payload, d.status, d.attempts,
            d.last_status_code, d.last_error, d.created_at, d.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'attemptNumber', a.attempt_number,
                  'statusCode', a.status_code,
                  'error', a.error,
                  'durationMs', a.duration_ms,
                  'createdAt', a.created_at
                ) ORDER BY a.attempt_number
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'::json
            ) AS attempt_history
       FROM webhook_deliveries d
      JOIN payments p ON p.tx_hash = d.payment_tx_hash AND p.merchant_id = $1
       LEFT JOIN webhook_attempts a ON a.delivery_id = d.id
       GROUP BY d.id
       ORDER BY d.updated_at DESC, d.id DESC
       LIMIT 50`,
     [merchantId],
  );
  return result.rows;
}

export async function requeueFailedDelivery(
  client: Client,
  id: number,
  merchantId: number,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE webhook_deliveries
       SET status = 'pending', attempts = 0, next_retry_at = now(), updated_at = now()
       WHERE id = $1 AND status IN ('failed', 'dead_letter')
         AND EXISTS (
           SELECT 1 FROM payments p
           WHERE p.tx_hash = webhook_deliveries.payment_tx_hash AND p.merchant_id = $2
         )
       RETURNING id`,
    [id, merchantId],
  );
  return (result.rowCount ?? 0) > 0;
}
