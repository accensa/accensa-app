import type { Client } from 'pg';
import { logger } from '../log.ts';
import { WebhookDeliveryError } from './errors.ts';
import {
  fetchRecentDeliveries,
  fetchRecentFailures,
  fetchStatusCounts,
  pendingDue,
  type DeliveryLogRow,
} from './repository.ts';

export interface WebhookSummary {
  pending: number;
  failed: number;
  deadLetter: number;
  delivered: number;
  lag: number;
  recentFailed: Array<{
    id: number;
    paymentTxHash: string;
    status: string;
    attempts: number;
    lastStatusCode: number | null;
    lastError: string | null;
    updatedAt: string;
  }>;
  recentDeliveries: Array<{
    id: number;
    paymentTxHash: string;
    payload: DeliveryLogRow['payload'];
    status: string;
    attempts: number;
    lastStatusCode: number | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    attemptHistory: Array<{
      attemptNumber: number;
      statusCode: number | null;
      error: string | null;
      durationMs: number;
      createdAt: string;
    }>;
  }>;
}

/** Status tallies, lag, and the recent-failure list for the operations page. */
export async function webhookSummary(client: Client, merchantId: number): Promise<WebhookSummary> {
  try {
    const counts = await fetchStatusCounts(client, merchantId);
    const byStatus: Record<string, number> = {
      pending: 0,
      failed: 0,
      delivered: 0,
      dead_letter: 0,
    };
    for (const row of counts) byStatus[row.status] = Number(row.n);

    const recent = await fetchRecentFailures(client, merchantId);
    const deliveries = await fetchRecentDeliveries(client, merchantId);

    logger.debug('Webhook summary retrieved', {
      pending: byStatus.pending,
      delivered: byStatus.delivered,
      failed: byStatus.failed,
      deadLetter: byStatus.dead_letter,
    });

    return {
      pending: (byStatus.pending ?? 0) + (byStatus.delivering ?? 0),
      failed: byStatus.failed ?? 0,
      deadLetter: byStatus.dead_letter ?? 0,
      delivered: byStatus.delivered ?? 0,
      lag: await pendingDue(client, { merchantId }),
      recentFailed: recent.map((row) => ({
        id: Number(row.id),
        paymentTxHash: row.payment_tx_hash,
        status: row.status,
        attempts: row.attempts,
        lastStatusCode: row.last_status_code,
        lastError: row.last_error,
        updatedAt:
          row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      })),
      recentDeliveries: deliveries.map((row) => ({
        id: Number(row.id),
        paymentTxHash: row.payment_tx_hash,
        payload: row.payload,
        status: row.status,
        attempts: row.attempts,
        lastStatusCode: row.last_status_code,
        lastError: row.last_error,
        createdAt:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt:
          row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        attemptHistory: row.attempt_history.map((attempt) => ({
          ...attempt,
          durationMs: Number(attempt.durationMs),
          createdAt:
            attempt.createdAt instanceof Date
              ? attempt.createdAt.toISOString()
              : String(attempt.createdAt),
        })),
      })),
    };
  } catch (e) {
    logger.error('Failed to retrieve webhook summary', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError('Failed to retrieve webhook summary', undefined, true);
  }
}
