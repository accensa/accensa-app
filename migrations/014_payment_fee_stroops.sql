-- 014_payment_fee_stroops.sql
--
-- Observed Stellar network fees for settled payments (#730).
--
-- `fee_charged` is resolved from Horizon by the indexer and stored as an
-- integer stroop count. NULL is meaningful: Horizon was unavailable, the
-- lookup timed out, or the payment predates fee capture. Analytics must not
-- turn that unknown into the 100-stroop base fee — it excludes unpriced rows.
--
-- Numbered 014 because 010 is already taken by payments_filter_indexes.

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_stroops BIGINT;

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back.
--
-- BEGIN;
-- ALTER TABLE payments DROP COLUMN IF EXISTS fee_stroops;
-- COMMIT;
