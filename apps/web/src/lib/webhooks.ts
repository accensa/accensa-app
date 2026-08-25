import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import type { Client } from 'pg';

/**
 * Outbound payment webhooks.
 *
 * Delivery is deliberately not part of indexing. The indexer inserts a
 * `webhook_deliveries` row in the same transaction as the payment; a separate
 * path (`/api/webhooks/deliver`) ships the payload. A host that sleeps, 500s,
 * or rate-limits cannot stall the ledger cursor.
 */

export const MAX_ATTEMPTS = 8;
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ATTEMPT_TIMEOUT_MS = 2_000;
export const MAX_BACKOFF_MS = 60 * 60 * 1000;

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

export interface PaymentPayload {
  tx_hash: string;
  ledger: number | null;
  payer: string | null;
  amount: string | null;
  asset: string | null;
  ts: string | null;
  route: string | null;
  method: string | null;
}

export function shouldRetry(status: number | null, transportError: boolean): boolean {
  if (transportError) return true;
  if (status === null) return true;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return now + Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return date;
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  return Math.floor(exp + random() * exp * 0.25);
}

export function nextRetryAt(opts: {
  attempt: number;
  createdAtMs: number;
  now: number;
  retryAfterHeader?: string | null;
  random?: () => number;
}): Date | null {
  if (opts.now - opts.createdAtMs >= DELIVERY_WINDOW_MS) return null;
  if (opts.attempt >= MAX_ATTEMPTS) return null;
  const fromHeader = parseRetryAfter(opts.retryAfterHeader, opts.now);
  const fromBackoff = opts.now + backoffMs(opts.attempt, opts.random ?? Math.random);
  const at = Math.max(fromHeader ?? 0, fromBackoff);
  if (at - opts.createdAtMs >= DELIVERY_WINDOW_MS) return null;
  return new Date(at);
}

export function canonicalPayload(payment: PaymentPayload): string {
  // Deterministic JSON: the bytes we sign are the bytes we send.
  return JSON.stringify({
    tx_hash: payment.tx_hash,
    ledger: payment.ledger,
    payer: payment.payer,
    amount: payment.amount,
    asset: payment.asset,
    ts: payment.ts,
    route: payment.route,
    method: payment.method,
  });
}

export function signBody(body: string, privateKeyHex: string): string {
  const keyBuffer = Buffer.from(privateKeyHex, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('WEBHOOK_SIGNING_KEY must be a 32-byte Ed25519 private key in hex');
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), keyBuffer]),
    format: 'der',
    type: 'pkcs8',
  });
  return edSign(null, Buffer.from(body, 'utf8'), privateKey).toString('hex');
}

export function payloadFromRow(row: Record<string, unknown>): PaymentPayload {
  const ts = row.ts;
  return {
    tx_hash: String(row.tx_hash),
    ledger: row.ledger === null || row.ledger === undefined ? null : Number(row.ledger),
    payer: row.payer == null ? null : String(row.payer),
    amount: row.amount == null ? null : String(row.amount),
    asset: row.asset == null ? null : String(row.asset),
    ts: ts instanceof Date ? ts.toISOString() : ts == null ? null : String(ts),
    route: row.route == null ? null : String(row.route),
    method: row.method == null ? null : String(row.method),
  };
}

export async function enqueueWebhookDelivery(
  client: Client,
  payment: PaymentPayload,
  url: string,
): Promise<void> {
  const body = canonicalPayload(payment);
  await client.query(
    `INSERT INTO webhook_deliveries (payment_tx_hash, url, payload, status, next_retry_at)
     VALUES ($1, $2, $3::jsonb, 'pending', now())
     ON CONFLICT (payment_tx_hash, url) DO NOTHING`,
    [payment.tx_hash, url, body],
  );
}

export interface AttemptResult {
  id: number;
  status: DeliveryStatus;
  statusCode: number | null;
  error: string | null;
}

export async function deliverDue(
  client: Client,
  opts: {
    now?: Date;
    fetchImpl?: typeof fetch;
    signingKey?: string | null;
    timeoutMs?: number;
    budgetMs?: number;
  } = {},
): Promise<{ attempted: number; delivered: number; failed: number; retried: number }> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const budgetMs = opts.budgetMs ?? 8_000;
  const deadline = Date.now() + budgetMs;
  const signingKey =
    opts.signingKey === undefined ? process.env.WEBHOOK_SIGNING_KEY : opts.signingKey;

  await client.query(
    `UPDATE webhook_deliveries
     SET status = 'pending', updated_at = now()
     WHERE status = 'delivering' AND updated_at < now() - interval '1 minute'`,
  );

  const due = await client.query<{
    id: string;
    payment_tx_hash: string;
    url: string;
    payload: PaymentPayload;
    attempts: number;
    created_at: Date;
  }>(
    `SELECT id, payment_tx_hash, url, payload, attempts, created_at
     FROM webhook_deliveries
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= $1)
     ORDER BY next_retry_at NULLS FIRST, id ASC
     LIMIT 50`,
    [now],
  );

  const claimed: typeof due.rows = [];
  for (const row of due.rows) {
    const take = await client.query(
      `UPDATE webhook_deliveries SET status = 'delivering', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [row.id],
    );
    if ((take.rowCount ?? 0) > 0) claimed.push(row);
  }

  let delivered = 0;
  let failed = 0;
  let retried = 0;

  for (const row of claimed) {
    if (Date.now() >= deadline) {
      await client.query(
        `UPDATE webhook_deliveries SET status = 'pending', updated_at = now() WHERE id = $1 AND status = 'delivering'`,
        [row.id],
      );
      continue;
    }

    const body = typeof row.payload === 'string' ? row.payload : canonicalPayload(row.payload);
    const attemptNumber = row.attempts + 1;
    const createdAtMs =
      row.created_at instanceof Date
        ? row.created_at.getTime()
        : Date.parse(String(row.created_at));

    if (!signingKey) {
      await recordAttempt(client, {
        id: Number(row.id),
        attemptNumber,
        statusCode: null,
        error: 'WEBHOOK_SIGNING_KEY is not configured; refusing to send an unsigned payload',
        createdAtMs,
        nowMs: Date.now(),
        retryAfter: null,
        transportError: true,
      });
      failed++;
      continue;
    }

    let statusCode: number | null = null;
    let error: string | null = null;
    let retryAfter: string | null = null;
    let transportError = false;

    try {
      const signature = signBody(body, signingKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const fetchPromise = fetchImpl(row.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
            'X-Accensa-Timestamp': String(Math.floor(Date.now() / 1000)),
            'X-Accensa-Delivery-Id': String(row.id),
          },
          body,
          signal: controller.signal,
        });
        const res = await Promise.race([
          fetchPromise,
          new Promise<never>((_, reject) => {
            const id = setTimeout(
              () => reject(Object.assign(new Error('webhook timeout'), { name: 'TimeoutError' })),
              timeoutMs,
            );
            controller.signal.addEventListener('abort', () => {
              clearTimeout(id);
              reject(Object.assign(new Error('webhook timeout'), { name: 'TimeoutError' }));
            });
          }),
        ]);
        statusCode = res.status;
        retryAfter = res.headers.get('retry-after');
        if (!res.ok) error = `HTTP ${res.status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      transportError = true;
      error = e instanceof Error ? e.message : 'transport error';
    }

    const terminal = await recordAttempt(client, {
      id: Number(row.id),
      attemptNumber,
      statusCode,
      error,
      createdAtMs,
      nowMs: Date.now(),
      retryAfter,
      transportError,
    });
    if (terminal.status === 'delivered') delivered++;
    else if (terminal.status === 'failed') failed++;
    else retried++;
  }

  return { attempted: claimed.length, delivered, failed, retried };
}

async function recordAttempt(
  client: Client,
  input: {
    id: number;
    attemptNumber: number;
    statusCode: number | null;
    error: string | null;
    createdAtMs: number;
    nowMs: number;
    retryAfter: string | null;
    transportError: boolean;
  },
): Promise<AttemptResult> {
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
  else status = 'failed';

  await client.query(
    `INSERT INTO webhook_attempts (delivery_id, attempt_number, status_code, error)
     VALUES ($1, $2, $3, $4)`,
    [input.id, input.attemptNumber, input.statusCode, input.error],
  );

  await client.query(
    `UPDATE webhook_deliveries
     SET status = $2,
         attempts = $3,
         last_status_code = $4,
         last_error = $5,
         next_retry_at = $6,
         delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
         updated_at = now()
     WHERE id = $1`,
    [input.id, status, input.attemptNumber, input.statusCode, input.error, next],
  );

  return { id: input.id, status, statusCode: input.statusCode, error: input.error };
}

export async function webhookSummary(client: Client): Promise<{
  pending: number;
  failed: number;
  delivered: number;
  recentFailed: Array<{
    id: number;
    paymentTxHash: string;
    status: string;
    attempts: number;
    lastStatusCode: number | null;
    lastError: string | null;
    updatedAt: string;
  }>;
}> {
  const counts = await client.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM webhook_deliveries GROUP BY status`,
  );
  const byStatus: Record<string, number> = { pending: 0, failed: 0, delivered: 0 };
  for (const row of counts.rows) byStatus[row.status] = Number(row.n);

  const recent = await client.query<{
    id: string;
    payment_tx_hash: string;
    status: string;
    attempts: number;
    last_status_code: number | null;
    last_error: string | null;
    updated_at: Date;
  }>(
    `SELECT id, payment_tx_hash, status, attempts, last_status_code, last_error, updated_at
     FROM webhook_deliveries
     WHERE status = 'failed'
     ORDER BY updated_at DESC
     LIMIT 20`,
  );

  return {
    pending: (byStatus.pending ?? 0) + (byStatus.delivering ?? 0),
    failed: byStatus.failed ?? 0,
    delivered: byStatus.delivered ?? 0,
    recentFailed: recent.rows.map((row) => ({
      id: Number(row.id),
      paymentTxHash: row.payment_tx_hash,
      status: row.status,
      attempts: row.attempts,
      lastStatusCode: row.last_status_code,
      lastError: row.last_error,
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    })),
  };
}

/** Hash of the body, useful in tests to assert we signed the bytes we sent. */
export function bodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
