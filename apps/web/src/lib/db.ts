import { Client } from 'pg';

/**
 * Opens a database connection.
 *
 * There is deliberately no default connection string: a fallback committed to
 * the repository is a published credential. Use the Supabase *session pooler*
 * host in production - Vercel Functions have no IPv6 route, and Supabase direct
 * connections (db.<ref>.supabase.co) are IPv6-only.
 */
export function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  return url;
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Brings the schema up to the canonical shape.
 *
 * Idempotent, and safe against either historical layout - see
 * migrations/001_unify_payments.sql for the full reasoning. Kept in code as
 * well so a fresh database works without a manual migration step.
 */
export async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
 CREATE TABLE IF NOT EXISTS payments (
 tx_hash VARCHAR(64) PRIMARY KEY,
 ledger BIGINT,
 payer VARCHAR(56),
 amount NUMERIC,
 asset VARCHAR(64),
 ts TIMESTAMPTZ,
 route VARCHAR(255),
 method VARCHAR(10),
 request_id VARCHAR(64)
 );
 `);

  // Older four-column layout keyed the time column"timestamp".
  await client.query(`
 DO $$
 BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_name='payments' AND column_name='timestamp')
 AND NOT EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_name='payments' AND column_name='ts') THEN
 ALTER TABLE payments RENAME COLUMN"timestamp"TO ts;
 END IF;
 END $$;
 `);

  for (const [col, type] of [
    ['ledger', 'BIGINT'],
    ['asset', 'VARCHAR(64)'],
    ['ts', 'TIMESTAMPTZ'],
    ['route', 'VARCHAR(255)'],
    ['method', 'VARCHAR(10)'],
    ['request_id', 'VARCHAR(64)'],
    ['hook_reported_at', 'TIMESTAMPTZ'],
  ]) {
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ${col} ${type};`);
  }

  await client.query(`
 CREATE TABLE IF NOT EXISTS sync_state (
 id INT PRIMARY KEY DEFAULT 1,
 last_ledger BIGINT NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sync_state_singleton CHECK (id = 1)
 );
 `);

  // Attribution reported by the merchant arrives before the indexer has seen
  // the transfer — the sync job runs on a schedule, the hook fires the instant
  // x402 settles. Those staged rows have no amount or payer yet, and inventing
  // a zero to satisfy a constraint is exactly the fabrication this codebase
  // exists to avoid. The chain fills them in.
  for (const col of ['amount', 'payer']) {
    await client.query(`ALTER TABLE payments ALTER COLUMN ${col} DROP NOT NULL;`);
  }

  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_ts ON payments(ts DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_route ON payments(route);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer);`);

  // Mapping from an on-chain ReceiptAnchor batch to the payments that formed
  // it. `selection_hash` is sha256 of the selected tx_hashes in ledger order,
  // so submitting the same set twice hits this unique key instead of anchoring
  // a second batch. `status` is what makes the gap between "the contract
  // accepted the transaction" and "we wrote the proofs" recoverable:
  //   previewed  — tree built, nothing submitted
  //   submitted  — on-chain succeeded, proofs not yet persisted (retry this)
  //   recorded   — payments carry batch_id + proof; serveable
  await client.query(`
    CREATE TABLE IF NOT EXISTS receipt_batches (
      selection_hash VARCHAR(64) PRIMARY KEY,
      batch_id BIGINT UNIQUE,
      root VARCHAR(64) NOT NULL,
      count INT NOT NULL,
      period_start BIGINT NOT NULL,
      period_end BIGINT NOT NULL,
      start_ledger BIGINT NOT NULL,
      end_ledger BIGINT NOT NULL,
      anchor_tx VARCHAR(64),
      status VARCHAR(20) NOT NULL,
      proofs JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS batch_id BIGINT;`);
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_leaf VARCHAR(64);`);
  await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_proof JSONB;`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_batch_id ON payments(batch_id);`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id BIGSERIAL PRIMARY KEY,
      payment_tx_hash VARCHAR(64) NOT NULL,
      url TEXT NOT NULL,
      payload JSONB NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      last_status_code INT,
      last_error TEXT,
      next_retry_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (payment_tx_hash, url)
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS webhook_attempts (
      id BIGSERIAL PRIMARY KEY,
      delivery_id BIGINT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
      attempt_number INT NOT NULL,
      status_code INT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
     ON webhook_deliveries (next_retry_at) WHERE status = 'pending';`,
  );
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries (status);`,
  );
}

/**
 * Records merchant-reported route attribution against a payment.
 *
 * Attribution is the one fact the chain cannot supply: a SAC `transfer` event
 * has no notion of an HTTP route. It therefore arrives from the seller's own
 * process and is trusted only as far as the shared secret guarding this path.
 *
 * `hook_reported_at` marks the row as carrying merchant-reported data, so the
 * two provenances stay distinguishable downstream. Ledger fields are never
 * written here — if the transfer has not been indexed yet, the row is staged
 * with a null ledger and the sync job fills in the on-chain truth later.
 *
 * A staged row also has a null `ts`, which is what keeps it out of the
 * dashboard: /api/payments filters on `ts IS NOT NULL`, so an attribution can
 * never be presented as revenue before the chain confirms the transfer.
 *
 * Returns whether the settlement matched an already-indexed payment.
 */
export async function recordSettlement(
  client: Client,
  s: {
    txHash: string;
    route: string;
    method: string;
    requestId?: string | null;
    payer?: string | null;
    reportedAt?: string | null;
  },
): Promise<{ matchedExistingPayment: boolean }> {
  const reportedAt = s.reportedAt ?? new Date().toISOString();
  const updated = await client.query(
    `UPDATE payments
 SET route = $2, method = $3, request_id = $4, hook_reported_at = $5
 WHERE tx_hash = $1 AND (hook_reported_at IS NULL OR hook_reported_at < $5)`,
    [s.txHash, s.route, s.method, s.requestId ?? null, reportedAt],
  );

  if ((updated.rowCount ?? 0) > 0) return { matchedExistingPayment: true };

  await client.query(
    `INSERT INTO payments (tx_hash, payer, route, method, request_id, ts, hook_reported_at)
 VALUES ($1, $2, $3, $4, $5, NULL, $6)
 ON CONFLICT (tx_hash) DO UPDATE
 SET route = EXCLUDED.route,
 method = EXCLUDED.method,
 request_id = EXCLUDED.request_id,
 hook_reported_at = EXCLUDED.hook_reported_at
 WHERE payments.hook_reported_at IS NULL OR payments.hook_reported_at < EXCLUDED.hook_reported_at`,
    [s.txHash, s.payer ?? null, s.route, s.method, s.requestId ?? null, reportedAt],
  );

  return { matchedExistingPayment: false };
}

export async function getLastSyncedLedger(client: Client): Promise<number | null> {
  const res = await client.query<{ last_ledger: string }>(
    `SELECT last_ledger FROM sync_state WHERE id = 1`,
  );
  return res.rows.length ? Number(res.rows[0].last_ledger) : null;
}

/**
 * The indexer's own record of when it last committed progress.
 *
 * Read by /api/payments so the dashboard can say how current its data is,
 * rather than implying the freshness of its own poll.
 */
export async function getSyncState(
  client: Client,
): Promise<{ lastLedger: number; updatedAt: string } | null> {
  const res = await client.query<{ last_ledger: string; updated_at: Date | string }>(
    `SELECT last_ledger, updated_at FROM sync_state WHERE id = 1`,
  );
  if (!res.rows.length) return null;
  const { last_ledger, updated_at } = res.rows[0];
  return {
    lastLedger: Number(last_ledger),
    updatedAt: updated_at instanceof Date ? updated_at.toISOString() : String(updated_at),
  };
}

export async function setLastSyncedLedger(client: Client, ledger: number): Promise<void> {
  // Use advisory lock to prevent concurrent double-processing of ranges
  await client.query('SELECT pg_advisory_xact_lock(1)');
  await client.query(
    `INSERT INTO sync_state (id, last_ledger, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()
     WHERE sync_state.last_ledger < EXCLUDED.last_ledger`,
    [merchantId, ledger],
  );
}

/**
 * Handles a chain rollback: purges indexed payments from ledgers the
 * corrected head no longer covers and rewinds the sync cursor to that head —
 * atomically.
 *
 * Stellar consensus means closed ledgers are rarely overturned, but a node
 * that lost state and re-synced from a snapshot, or a failover to a lagging
 * peer, can report a head *below* the cursor. Payments indexed from the lost
 * ledgers describe a chain that no longer exists; the next run re-indexes the
 * corrected range, so the purge is a rewind, not data loss. Staged rows with a
 * NULL ledger (merchant-reported attribution awaiting the chain) are
 * untouched: `ledger > $2` cannot match them, and the re-indexed transfer
 * fills them in later.
 *
 * The same advisory lock `setLastSyncedLedger` takes serializes this against
 * a concurrent forward run, and the cursor write deliberately omits that
 * function's forward-only `WHERE last_ledger < EXCLUDED.last_ledger` guard —
 * rewinding is the point. Both statements commit together, so a crash cannot
 * leave a cursor pointing past purged data.
 *
 * @returns The number of payment rows removed.
 */
export async function rollbackSyncToLedger(
  client: Client,
  merchantId: number,
  ledger: number,
): Promise<{ purged: number }> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [merchantId]);
    const res = await client.query(`DELETE FROM payments WHERE merchant_id = $1 AND ledger > $2`, [
      merchantId,
      ledger,
    ]);
    await client.query(
      `INSERT INTO sync_state (merchant_id, last_ledger, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (merchant_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()`,
      [merchantId, ledger],
    );
    await client.query('COMMIT');
    return { purged: res.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/**
 * Persists a nonce issued by /api/auth/challenge so /api/auth/verify can
 * confirm it was this server that minted it, and that it has not already
 * been used. Scoped to the merchant the challenge was issued for, so a nonce
 * minted for one merchant's login cannot be replayed to authenticate as
 * another.
 */
export async function storeNonce(client: Client, nonce: string, merchantId: number): Promise<void> {
  await client.query(`INSERT INTO challenge_nonces (nonce, merchant_id) VALUES ($1, $2)`, [
    nonce,
    merchantId,
  ]);
}

/**
 * Marks a nonce as consumed if it has not been used yet.
 *
 * Returns true when the nonce was valid and freshly consumed — that is the
 * one case where /api/auth/verify should proceed. A false return means the
 * nonce was unknown, already consumed, or expired, and the caller must 401.
 */
export async function consumeNonce(
  client: Client,
  nonce: string,
  merchantId: number,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE challenge_nonces
     SET consumed = true
     WHERE nonce = $1 AND merchant_id = $2 AND consumed = false`,
    [nonce, merchantId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Removes consumed nonces and any unconsumed ones older than `maxAge`.
 *
 * Called opportunistically from the challenge endpoint so the table does
 * not grow without bound. A 10-minute window covers the 5-minute
 * timebounds on the challenge plus generous clock skew.
 */
export async function sweepExpiredNonces(
  client: Client,
  maxAgeMs: number = 10 * 60 * 1000,
): Promise<void> {
  await client.query(
    `DELETE FROM challenge_nonces
     WHERE consumed = true
        OR issued_at < now() - interval '1 millisecond' * $1`,
    [maxAgeMs],
  );
}
