import { Client } from 'pg';

/**
 * Opens a database connection.
 *
 * There is deliberately no default connection string: a fallback committed to
 * the repository is a published credential. Use the Supabase *session pooler*
 * host in production — Vercel Functions have no IPv6 route, and Supabase direct
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
 * Idempotent, and safe against either historical layout — see
 * migrations/001_unify_payments.sql for the full reasoning. Kept in code as
 * well so a fresh database works without a manual migration step.
 */
export async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS payments (
      tx_hash    VARCHAR(64) PRIMARY KEY,
      ledger     BIGINT,
      payer      VARCHAR(56),
      amount     NUMERIC,
      asset      VARCHAR(64),
      ts         TIMESTAMPTZ,
      route      VARCHAR(255),
      method     VARCHAR(10),
      request_id VARCHAR(64)
    );
  `);

  // Older four-column layout keyed the time column "timestamp".
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='payments' AND column_name='timestamp')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='payments' AND column_name='ts') THEN
        ALTER TABLE payments RENAME COLUMN "timestamp" TO ts;
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
  ]) {
    await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ${col} ${type};`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id           INT PRIMARY KEY DEFAULT 1,
      last_ledger  BIGINT NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT sync_state_singleton CHECK (id = 1)
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_ts ON payments(ts DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_route ON payments(route);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer);`);
}

export async function getLastSyncedLedger(client: Client): Promise<number | null> {
  const res = await client.query<{ last_ledger: string }>(
    `SELECT last_ledger FROM sync_state WHERE id = 1`,
  );
  return res.rows.length ? Number(res.rows[0].last_ledger) : null;
}

export async function setLastSyncedLedger(client: Client, ledger: number): Promise<void> {
  await client.query(
    `INSERT INTO sync_state (id, last_ledger, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()`,
    [ledger],
  );
}
