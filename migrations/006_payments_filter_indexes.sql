-- 006_payments_filter_indexes.sql
--
-- Indexes backing the /api/payments filter parameters (#167).
--
-- Every query against payments is tenant-scoped first: RLS forces the
-- connection's `accensa.merchant_id`, and the route's WHERE clause leads with
-- `merchant_id = $1`. A filter such as `route` or `payer` without a composite
-- turns each filtered page into a sequential scan of an append-only table that
-- grows with every payment. The date-range filters use `ts`, which
-- idx_payments_merchant_ts_txhash (004) already leads with, so no additional
-- index is needed for those.
--
-- Partial indexes (WHERE col IS NOT NULL) skip the rows whose filter column
-- is absent — merchant-reported staged rows have a NULL route — keeping the
-- indexes smaller without changing results, since `route = $x` can never match
-- a NULL.
--
-- Applied automatically by ensureSchema() in apps/web/src/lib/db.ts, the same
-- way 001–005 are; committed here for documentation and for anyone restoring a
-- database outside the app.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_route
  ON payments(merchant_id, route)
  WHERE route IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_payer
  ON payments(merchant_id, payer)
  WHERE payer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_asset
  ON payments(merchant_id, asset)
  WHERE asset IS NOT NULL;

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back.
--
-- BEGIN;
-- DROP INDEX IF EXISTS idx_payments_merchant_route;
-- DROP INDEX IF EXISTS idx_payments_merchant_payer;
-- DROP INDEX IF EXISTS idx_payments_merchant_asset;
-- COMMIT;