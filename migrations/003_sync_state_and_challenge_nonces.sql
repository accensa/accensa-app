-- 003_sync_state_and_challenge_nonces.sql
--
-- Creates the two tables that existed only in ensureSchema() (apps/web/src/lib/db.ts)
-- but were never part of the versioned migration set: sync_state (the indexer
-- cursor) and challenge_nonces (single-use /api/auth/challenge nonces).
--
-- 004_multi_merchant.sql ALTERs both tables (adds merchant_id, drops the
-- sync_state singleton CHECK, enables row-level security on sync_state), so a
-- database built from this directory alone failed at that point. This file is
-- ordered before 004_multi_merchant.sql and gives them the exact pre-004 shape
-- ensureSchema creates, including the sync_state_singleton CHECK that 003 later
-- drops. Every statement is idempotent, so applying it to a database that
-- ensureSchema already built is a no-op.
--
-- It is committed here for documentation and for anyone restoring a database
-- outside the app.

BEGIN;

-- Indexer cursor. Singleton by CHECK until 003_multi_merchant.sql makes it
-- per-merchant.
CREATE TABLE IF NOT EXISTS sync_state (
    id INT PRIMARY KEY DEFAULT 1,
    last_ledger BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sync_state_singleton CHECK (id = 1)
);

-- Single-use nonces for /api/auth/challenge, consumed by /api/auth/verify so an
-- unrelated signed transaction cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS challenge_nonces (
    nonce VARCHAR(64) PRIMARY KEY,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_challenge_nonces_issued ON challenge_nonces(issued_at DESC);

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back. Roll back
-- 003_multi_merchant.sql first: it adds columns, policies and foreign keys
-- to both tables.
--
-- DROP INDEX IF EXISTS idx_challenge_nonces_issued;
-- DROP TABLE IF EXISTS challenge_nonces;
-- DROP TABLE IF EXISTS sync_state;
