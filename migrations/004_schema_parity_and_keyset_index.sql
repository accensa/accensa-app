-- 004_schema_parity_and_keyset_index.sql
--
-- Two fixes that belong in the single source of truth (issue #91, #93):
--
--  1. idx_payments_hook_reported existed only in migrations/002, never in
--     lib/db.ts:ensureSchema(). A database provisioned by code alone was
--     missing it. Recreate it here so both provisioning paths converge, and
--     so a `psql -f migrations/*.sql` run against a code-built database is a
--     no-op rather than a diff.
--
--  2. /api/payments paginates by keyset:
--       WHERE ts IS NOT NULL AND (ts < $1 OR (ts = $1 AND tx_hash < $2))
--       ORDER BY ts DESC, tx_hash DESC
--     and is tenant-scoped by merchant_id. The existing indexes
--     (idx_payments_ts, idx_payments_merchant_ts) do not cover the tie-break
--     on tx_hash, so deep pages sort in memory. This composite matches the
--     ORDER BY exactly.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_payments_hook_reported
  ON payments(hook_reported_at)
  WHERE hook_reported_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_ts_txhash
  ON payments(merchant_id, ts DESC, tx_hash DESC);

COMMIT;
