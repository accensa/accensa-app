-- 003_multi_merchant.sql
--
-- Turns this deployment from single-merchant-by-environment-variable into
-- multi-merchant-by-row. See DESIGN.md "Multi-merchant support" for the full
-- design and the reasoning behind each choice below.
--
-- Reversible: the DOWN section at the bottom undoes every change here,
-- including collapsing back onto a single merchant (the one identified by
-- MERCHANT_ADDRESS at the time this migration is rolled back).
--
-- This file is applied automatically by `ensureSchema()` in
-- apps/web/src/lib/db.ts on every request, the same way 001 and 002 were.
-- It is committed here too for documentation and for anyone restoring a
-- database outside the app.

BEGIN;

-- One row per tenant. `address` is the identity everything else keys off:
-- the SAC transfer recipient the indexer filters on, and the account that
-- signs into the dashboard. `public_key_hex` is the separate key that signs
-- /api/hook/settle reports (historically MERCHANT_PUBLIC_KEY) — kept apart
-- because a seller's settlement-reporting key need not be their Stellar
-- signing key. The three override columns fall back to the deployment-wide
-- env vars (ASSET_CONTRACT_IDS, NEXT_PUBLIC_REFUND_VAULT_ID, WEBHOOK_URL)
-- when null, so a freshly backfilled single-merchant row needs no new
-- configuration to keep working exactly as before.
CREATE TABLE IF NOT EXISTS merchants (
    id                 SERIAL PRIMARY KEY,
    address            VARCHAR(56) UNIQUE NOT NULL,
    public_key_hex     VARCHAR(64),
    asset_contract_ids TEXT,
    refund_vault_id    VARCHAR(56),
    webhook_url        TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill the one merchant every existing deployment already has. Safe to
-- run with no MERCHANT_ADDRESS set (a brand-new database): the DO block is a
-- no-op in that case and merchants stays empty until one is inserted.
DO $$
DECLARE
    v_address text := current_setting('accensa.merchant_address', true);
    v_public_key text := current_setting('accensa.merchant_public_key', true);
BEGIN
    IF v_address IS NOT NULL AND v_address <> '' THEN
        INSERT INTO merchants (address, public_key_hex)
        VALUES (v_address, NULLIF(v_public_key, ''))
        ON CONFLICT (address) DO NOTHING;
    END IF;
END $$;

-- payments: was keyed on tx_hash alone, globally. A tx_hash is unique per
-- Stellar transaction but a single deployment could in principle see the
-- same hash matter to two merchants (e.g. a batch payment splitting to two
-- recipients in one transaction), so the identity becomes the pair.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);

DO $$
DECLARE
    v_merchant_id int;
BEGIN
    SELECT id INTO v_merchant_id FROM merchants ORDER BY id ASC LIMIT 1;
    IF v_merchant_id IS NOT NULL THEN
        UPDATE payments SET merchant_id = v_merchant_id WHERE merchant_id IS NULL;
    END IF;
END $$;

-- Only tighten once every row has a merchant — an empty or not-yet-backfilled
-- table must not block the migration from applying.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM payments WHERE merchant_id IS NULL) THEN
        ALTER TABLE payments ALTER COLUMN merchant_id SET NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'payments' AND constraint_type = 'PRIMARY KEY' AND constraint_name = 'payments_pkey'
    ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_pkey;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'payments' AND constraint_type = 'PRIMARY KEY'
    ) AND NOT EXISTS (SELECT 1 FROM payments WHERE merchant_id IS NULL) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_pkey PRIMARY KEY (merchant_id, tx_hash);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_ts ON payments(merchant_id, ts DESC);

-- sync_state was a singleton by CHECK constraint. The cursor becomes
-- per-merchant, keyed by merchant_id instead of the fixed id = 1.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);

DO $$
DECLARE
    v_merchant_id int;
BEGIN
    SELECT id INTO v_merchant_id FROM merchants ORDER BY id ASC LIMIT 1;
    IF v_merchant_id IS NOT NULL THEN
        UPDATE sync_state SET merchant_id = v_merchant_id WHERE merchant_id IS NULL;
    END IF;
END $$;

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
    ALTER TABLE sync_state ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE sync_state DROP COLUMN IF EXISTS id;
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

-- challenge_nonces: scoped so a nonce issued for one merchant's challenge
-- cannot be replayed against another merchant's verify call. Nullable
-- because unconsumed pre-migration nonces (at most a few minutes old) have
-- no merchant to backfill; they simply expire via sweepExpiredNonces.
ALTER TABLE challenge_nonces ADD COLUMN IF NOT EXISTS merchant_id INT REFERENCES merchants(id);

-- Row-level security as a second line of defence behind the application's own
-- WHERE merchant_id = $1 scoping. FORCE (not just ENABLE) so it also applies
-- to the table owner — the role this app connects as — since Postgres RLS is
-- normally bypassed by the owner. Each request sets accensa.merchant_id for
-- the lifetime of its connection (see withMerchantClient in lib/db.ts); a
-- query that forgets its WHERE clause returns zero rows instead of every
-- merchant's data.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payments_merchant_isolation ON payments;
CREATE POLICY payments_merchant_isolation ON payments
    USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
    WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_state_merchant_isolation ON sync_state;
CREATE POLICY sync_state_merchant_isolation ON sync_state
    USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
    WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back.
--
-- BEGIN;
-- ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS payments_merchant_isolation ON payments;
-- ALTER TABLE sync_state DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS sync_state_merchant_isolation ON sync_state;
--
-- ALTER TABLE challenge_nonces DROP COLUMN IF EXISTS merchant_id;
--
-- ALTER TABLE sync_state DROP CONSTRAINT IF EXISTS sync_state_pkey;
-- ALTER TABLE sync_state ADD COLUMN id INT DEFAULT 1;
-- UPDATE sync_state SET id = 1;
-- ALTER TABLE sync_state ADD CONSTRAINT sync_state_pkey PRIMARY KEY (id);
-- ALTER TABLE sync_state ADD CONSTRAINT sync_state_singleton CHECK (id = 1);
-- ALTER TABLE sync_state DROP COLUMN IF EXISTS merchant_id;
--
-- ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_pkey;
-- ALTER TABLE payments ADD CONSTRAINT payments_pkey PRIMARY KEY (tx_hash);
-- DROP INDEX IF EXISTS idx_payments_merchant_ts;
-- ALTER TABLE payments DROP COLUMN IF EXISTS merchant_id;
--
-- DROP TABLE IF EXISTS merchants;
-- COMMIT;
