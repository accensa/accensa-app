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
 * Opens a connection scoped to one merchant for the lifetime of the request.
 *
 * `accensa.merchant_id` backs the row-level security policies on `payments`
 * and `sync_state` (see migrations/003_multi_merchant.sql) — it is the second
 * line of defence behind the application's own `WHERE merchant_id = $1`
 * clauses, so a query that forgets that clause returns nothing instead of
 * every merchant's data. Set once per connection, not per statement, since
 * `withClient` already opens and tears down a fresh `Client` per request.
 */
export async function withMerchantClient<T>(
  merchantId: number,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('SELECT set_config($1, $2, false)', [
      'accensa.merchant_id',
      String(merchantId),
    ]);
    return fn(client);
  });
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

  // Auth challenge nonces — issued by /api/auth/challenge, consumed by
  // /api/auth/verify. Prevents replay of unrelated signed transactions.
  await client.query(`
 CREATE TABLE IF NOT EXISTS challenge_nonces (
   nonce VARCHAR(64) PRIMARY KEY,
   issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   consumed BOOLEAN NOT NULL DEFAULT false
 );
 `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_challenge_nonces_issued ON challenge_nonces(issued_at DESC);`,
  );

  await ensureMultiMerchantSchema(client);
}

/**
 * Migrates the schema from single-merchant-by-env-var to multi-merchant-by-row.
 *
 * See migrations/003_multi_merchant.sql for the same steps as a standalone
 * SQL file, and DESIGN.md for the reasoning. This is the copy that actually
 * runs — `ensureSchema` is invoked defensively at the top of nearly every
 * DB-touching handler, the same pattern 001 and 002 already used.
 *
 * A fresh, unmigrated deployment with `MERCHANT_ADDRESS` set backfills its one
 * merchant automatically, so upgrading requires no manual SQL and no new
 * environment variables.
 */
async function ensureMultiMerchantSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      id                 SERIAL PRIMARY KEY,
      address            VARCHAR(56) UNIQUE NOT NULL,
      public_key_hex     VARCHAR(64),
      asset_contract_ids TEXT,
      refund_vault_id    VARCHAR(56),
      webhook_url        TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  if (process.env.MERCHANT_ADDRESS) {
    await client.query(
      `INSERT INTO merchants (address, public_key_hex)
       VALUES ($1, $2)
       ON CONFLICT (address) DO NOTHING`,
      [process.env.MERCHANT_ADDRESS, process.env.MERCHANT_PUBLIC_KEY ?? null],
    );
  }

  await client.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);`,
  );
  await client.query(`
    DO $$
    DECLARE v_merchant_id int;
    BEGIN
      SELECT id INTO v_merchant_id FROM merchants ORDER BY id ASC LIMIT 1;
      IF v_merchant_id IS NOT NULL THEN
        UPDATE payments SET merchant_id = v_merchant_id WHERE merchant_id IS NULL;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM payments WHERE merchant_id IS NULL) THEN
        ALTER TABLE payments ALTER COLUMN merchant_id SET NOT NULL;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'payments' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'payments_pkey'
      ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_pkey;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'payments' AND constraint_type = 'PRIMARY KEY'
      ) AND NOT EXISTS (SELECT 1 FROM payments WHERE merchant_id IS NULL) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_pkey PRIMARY KEY (merchant_id, tx_hash);
      END IF;
    END $$;
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_payments_merchant_ts ON payments(merchant_id, ts DESC);`,
  );

  await client.query(
    `ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);`,
  );
  await client.query(`
    DO $$
    DECLARE v_merchant_id int;
    BEGIN
      SELECT id INTO v_merchant_id FROM merchants ORDER BY id ASC LIMIT 1;
      IF v_merchant_id IS NOT NULL THEN
        UPDATE sync_state SET merchant_id = v_merchant_id WHERE merchant_id IS NULL;
      END IF;
    END $$;
  `);
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'sync_state' AND constraint_type = 'CHECK' AND constraint_name = 'sync_state_singleton'
      ) THEN
        ALTER TABLE sync_state DROP CONSTRAINT sync_state_singleton;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'sync_state' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'sync_state_pkey'
      ) THEN
        ALTER TABLE sync_state DROP CONSTRAINT sync_state_pkey;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sync_state' AND column_name = 'id'
      ) THEN
        ALTER TABLE sync_state ALTER COLUMN id DROP DEFAULT;
        ALTER TABLE sync_state DROP COLUMN id;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM sync_state WHERE merchant_id IS NULL) THEN
        ALTER TABLE sync_state ALTER COLUMN merchant_id SET NOT NULL;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'sync_state' AND constraint_type = 'PRIMARY KEY'
        ) THEN
          ALTER TABLE sync_state ADD CONSTRAINT sync_state_pkey PRIMARY KEY (merchant_id);
        END IF;
      END IF;
    END $$;
  `);

  await client.query(
    `ALTER TABLE challenge_nonces ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);`,
  );

  // Defence in depth: even the role this app connects as (the table owner,
  // which Postgres RLS normally exempts) is bound by these policies because
  // they are FORCEd, not merely ENABLEd. A query that omits its own
  // merchant_id filter gets zero rows back instead of every tenant's data.
  await client.query(`ALTER TABLE payments ENABLE ROW LEVEL SECURITY;`);
  await client.query(`ALTER TABLE payments FORCE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS payments_merchant_isolation ON payments;`);
  await client.query(`
    CREATE POLICY payments_merchant_isolation ON payments
      USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
      WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);
  `);

  await client.query(`ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;`);
  await client.query(`ALTER TABLE sync_state FORCE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS sync_state_merchant_isolation ON sync_state;`);
  await client.query(`
    CREATE POLICY sync_state_merchant_isolation ON sync_state
      USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
      WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);
  `);
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
  merchantId: number,
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
 SET route = $3, method = $4, request_id = $5, hook_reported_at = $6
 WHERE merchant_id = $1 AND tx_hash = $2 AND (hook_reported_at IS NULL OR hook_reported_at < $6)`,
    [merchantId, s.txHash, s.route, s.method, s.requestId ?? null, reportedAt],
  );

  if ((updated.rowCount ?? 0) > 0) return { matchedExistingPayment: true };

  await client.query(
    `INSERT INTO payments (merchant_id, tx_hash, payer, route, method, request_id, ts, hook_reported_at)
 VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
 ON CONFLICT (merchant_id, tx_hash) DO UPDATE
 SET route = EXCLUDED.route,
 method = EXCLUDED.method,
 request_id = EXCLUDED.request_id,
 hook_reported_at = EXCLUDED.hook_reported_at
 WHERE payments.hook_reported_at IS NULL OR payments.hook_reported_at < EXCLUDED.hook_reported_at`,
    [merchantId, s.txHash, s.payer ?? null, s.route, s.method, s.requestId ?? null, reportedAt],
  );

  return { matchedExistingPayment: false };
}

export async function getLastSyncedLedger(
  client: Client,
  merchantId: number,
): Promise<number | null> {
  const res = await client.query<{ last_ledger: string }>(
    `SELECT last_ledger FROM sync_state WHERE merchant_id = $1`,
    [merchantId],
  );
  return res.rows.length ? Number(res.rows[0].last_ledger) : null;
}

/**
 * The indexer's own record of when it last committed progress for a merchant.
 *
 * Read by /api/payments so the dashboard can say how current its data is,
 * rather than implying the freshness of its own poll.
 */
export async function getSyncState(
  client: Client,
  merchantId: number,
): Promise<{ lastLedger: number; updatedAt: string } | null> {
  const res = await client.query<{
    last_ledger: string;
    updated_at: Date | string;
  }>(`SELECT last_ledger, updated_at FROM sync_state WHERE merchant_id = $1`, [merchantId]);
  if (!res.rows.length) return null;
  const { last_ledger, updated_at } = res.rows[0];
  return {
    lastLedger: Number(last_ledger),
    updatedAt: updated_at instanceof Date ? updated_at.toISOString() : String(updated_at),
  };
}

export async function setLastSyncedLedger(
  client: Client,
  merchantId: number,
  ledger: number,
): Promise<void> {
  // Advisory lock keyed by merchant so concurrent syncs for different
  // merchants never block each other, only concurrent runs for the same one.
  await client.query('SELECT pg_advisory_xact_lock($1)', [merchantId]);
  await client.query(
    `INSERT INTO sync_state (merchant_id, last_ledger, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (merchant_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()
     WHERE sync_state.last_ledger < EXCLUDED.last_ledger`,
    [merchantId, ledger],
  );
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
