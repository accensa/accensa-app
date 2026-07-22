-- 001_unify_payments.sql
--
-- Unifies the `payments` table on a single canonical shape.
--
-- Background: three separate writers had been inserting into `payments` with
-- two incompatible schemas. The Go indexer created it with a `ts` column plus
-- route/method/asset/ledger; sync_github.js and the web API used a four-column
-- shape keyed on `timestamp`. Whichever ran first defined the live table, so the
-- attribution columns the product depends on were never populated.
--
-- This migration is idempotent and safe to run against either historical shape,
-- or against an empty database.

BEGIN;

-- Base table, for a database that has never seen `payments`.
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

-- Old four-column shape used `timestamp`. Carry the data over rather than
-- dropping it: rename when only the old column exists, otherwise backfill.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'timestamp'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'ts'
    ) THEN
        ALTER TABLE payments RENAME COLUMN "timestamp" TO ts;
    END IF;
END $$;

-- Columns missing from the old shape.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ledger     BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS asset      VARCHAR(64);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ts         TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS route      VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method     VARCHAR(10);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);

-- If both columns ended up present (mixed history), fold the old one in and drop it.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'timestamp'
    ) THEN
        UPDATE payments SET ts = "timestamp"::timestamptz WHERE ts IS NULL;
        ALTER TABLE payments DROP COLUMN "timestamp";
    END IF;
END $$;

-- Amounts are Stellar i128 stroops scaled to 7 decimal places. NUMERIC is
-- arbitrary precision; never store money as a float.
ALTER TABLE payments ALTER COLUMN amount TYPE NUMERIC USING amount::numeric;

-- Rows written by the previous fabricating writers carry invented amounts and
-- payers. They are not real observations and must not be presented as revenue.
DELETE FROM payments WHERE asset IS NULL OR ledger IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_ts    ON payments(ts DESC);
CREATE INDEX IF NOT EXISTS idx_payments_route ON payments(route);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer);

COMMIT;
