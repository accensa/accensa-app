-- 009_zk_commitments.sql
--
-- Commitment ledger for zero-knowledge-verified state transitions (#173).
--
-- Merchants require privacy for transaction volumes: the indexer must be able
-- to accept and verify a commitment to a state transition without storing the
-- plaintext. This table records what was *proven* — a binding commitment plus
-- a hash of the canonical payload that opened it — never the payload itself.
--
-- A leaked table therefore exposes nothing about the underlying data: the
-- commitment is hiding (an observer cannot recover the payload from it) and
-- the payload hash is one-way. The full plaintext lives only with the SDK
-- that submitted the proof.
--
-- Rows are scoped to the merchant that submitted them (`merchant_id`), and
-- every write path resolves the merchant from the session before inserting.
-- That scoping is enforced by the database as well as by the application:
-- row-level security (below) binds every connection, including the app's own,
-- so a query without the merchant scope reads nothing instead of everything.
--
-- This file is applied automatically by `ensureZkCommitmentsSchema()` in
-- apps/web/src/lib/zk-ledger.ts on every request to the proofs route. It is
-- committed here too for documentation and for anyone restoring a database
-- outside the app.

BEGIN;

CREATE TABLE IF NOT EXISTS zk_commitments (
    id            BIGSERIAL PRIMARY KEY,
    merchant_id   INT NOT NULL REFERENCES merchants(id),
    -- Hex SHA-256 commitment as submitted by the SDK. Unique per merchant so
    -- the same transition cannot be recorded twice.
    commitment    TEXT NOT NULL,
    -- SHA-256 of the canonical JSON payload that opened the commitment. This
    -- is the only trace of the underlying data; the payload itself is never
    -- stored.
    payload_hash  TEXT NOT NULL,
    -- Which verification scheme accepted this commitment, so a future scheme
    -- migration can tell old rows from new.
    proof_scheme  TEXT NOT NULL DEFAULT 'sha256-commitment-opening',
    verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT zk_commitments_unique_commitment
        UNIQUE (merchant_id, commitment)
);

CREATE INDEX IF NOT EXISTS idx_zk_commitments_merchant_verified
    ON zk_commitments (merchant_id, verified_at DESC);

-- Same isolation shape as payments/sync_state (003_multi_merchant.sql),
-- role_tuples (007) and merchant_stores (009). FORCE binds even the table
-- owner — the role this app connects as — so isolation does not rest on
-- application code alone. DROP POLICY first keeps a re-run safe.
ALTER TABLE zk_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE zk_commitments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zk_commitments_merchant_isolation ON zk_commitments;
CREATE POLICY zk_commitments_merchant_isolation ON zk_commitments
    USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
    WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back.
--
-- BEGIN;
-- DROP TABLE IF EXISTS zk_commitments;
-- COMMIT;
--
-- The row-level security policy and its ENABLE/FORCE flags are catalog rows
-- owned by zk_commitments, so DROP TABLE removes them with the table; there
-- is nothing separate to unwind.
