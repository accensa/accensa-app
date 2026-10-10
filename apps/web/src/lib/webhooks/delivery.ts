import type { Client } from 'pg';
import { logger } from '../log.ts';
import { ATTEMPT_TIMEOUT_MS } from './constants.ts';
import { WebhookDeliveryError } from './errors.ts';
import { canonicalPayload } from './payload.ts';
import {
  claimDelivery,
  fetchDueDeliveries,
  persistAttempt,
  requeueUnsent,
  resetStaleDelivering,
} from './repository.ts';
import { nextRetryAt, shouldRetry } from './retry-policy.ts';
import { attemptDelivery } from './transport.ts';
import type { AttemptResult, DeliveryStatus, DueDeliveryRow } from './types.ts';

export interface DeliverDueOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  signingKey?: string | null;
  timeoutMs?: number;
  budgetMs?: number;
}

/**
 * Ship every due delivery we can claim within the time budget.
 *
 * Kept deliberately thin after #350: the SQL lives in `repository.ts`, the
 * HTTP attempt in `transport.ts`, and the retry arithmetic in
 * `retry-policy.ts`. This module only orchestrates them and aggregates the
 * outcome counts.
 */
export async function deliverDue(
  client: Client,
  opts: DeliverDueOptions = {},
): Promise<{ attempted: number; delivered: number; failed: number; retried: number }> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? 8_000;
  const deadline = Date.now() + budgetMs;
  const signingKey =
    opts.signingKey === undefined ? process.env.WEBHOOK_SIGNING_KEY : opts.signingKey;

  await resetStaleDelivering(client);

  const dueRows = await fetchDueDeliveries(client, now);

  const claimed: DueDeliveryRow[] = [];
  for (const row of dueRows) {
    if (await claimDelivery(client, row)) claimed.push(row);
  }

  logger.info('Processing due webhook deliveries', { count: claimed.length });

  let delivered = 0;
  let failed = 0;
  let retried = 0;

  for (const row of claimed) {
    if (Date.now() >= deadline) {
      await requeueUnsent(client, row.id);
      continue;
    }

    const body = typeof row.payload === 'string' ? row.payload : canonicalPayload(row.payload);
    const attemptNumber = row.attempts + 1;
    const createdAtMs =
      row.created_at instanceof Date
        ? row.created_at.getTime()
        : Date.parse(String(row.created_at));

    if (!signingKey) {
      try {
        await recordAttempt(client, {
          id: Number(row.id),
          attemptNumber,
          statusCode: null,
          error: 'WEBHOOK_SIGNING_KEY is not configured; refusing to send an unsigned payload',
          durationMs: 0,
          createdAtMs,
          nowMs: Date.now(),
          retryAfter: null,
          transportError: true,
        });
      } catch (e) {
        logger.error('Failed to record unsigned payload attempt', {
          id: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      failed++;
      continue;
    }

    const outcome = await attemptDelivery({
      id: row.id,
      url: row.url,
      body,
      signingKey,
      fetchImpl,
      timeoutMs,
    });

    try {
      const terminal = await recordAttempt(client, {
        id: Number(row.id),
        attemptNumber,
        statusCode: outcome.statusCode,
        error: outcome.error,
        durationMs: outcome.durationMs,
        createdAtMs,
        nowMs: Date.now(),
        retryAfter: outcome.retryAfter,
        transportError: outcome.transportError,
      });
      if (terminal.status === 'delivered') delivered++;
      else if (terminal.status === 'failed' || terminal.status === 'dead_letter') failed++;
      else retried++;
    } catch (e) {
      logger.error('Failed to record delivery attempt', {
        id: row.id,
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  return { attempted: claimed.length, delivered, failed, retried };
}

export async function recordAttempt(
  client: Client,
  input: {
    id: number;
    attemptNumber: number;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
    createdAtMs: number;
    nowMs: number;
    retryAfter: string | null;
    transportError: boolean;
  },
): Promise<AttemptResult> {
  try {
    const ok = input.statusCode !== null && input.statusCode >= 200 && input.statusCode < 300;
    const retry = !ok && shouldRetry(input.statusCode, input.transportError);
    const next = retry
      ? nextRetryAt({
          attempt: input.attemptNumber,
          createdAtMs: input.createdAtMs,
          now: input.nowMs,
          retryAfterHeader: input.retryAfter,
        })
      : null;

    let status: DeliveryStatus;
    if (ok) status = 'delivered';
    else if (next) status = 'pending';
    else status = 'dead_letter';

    await persistAttempt({
      client,
      id: input.id,
      attemptNumber: input.attemptNumber,
      statusCode: input.statusCode,
      error: input.error,
      durationMs: input.durationMs,
      status,
      next,
    });

    logger.debug('Attempt recorded', { id: input.id, status, attemptNumber: input.attemptNumber });
    return { id: input.id, status, statusCode: input.statusCode, error: input.error };
  } catch (e) {
    logger.error('Failed to record webhook attempt', {
      id: input.id,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError(
      `Failed to record attempt for delivery ${input.id}`,
      undefined,
      true,
    );
  }
}
