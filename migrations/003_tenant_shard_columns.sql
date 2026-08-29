-- Tenant identifier for multi-tenant database sharding (issue #171).
--
-- Every row in `payments` today belongs to the single merchant this
-- deployment serves, and there is no tenant/workspace concept anywhere else
-- in the schema either — see apps/web/src/lib/auth.ts, which sessions by
-- Stellar public key, not by any notion of an organization. This migration
-- does not move a single row to a different database; it only adds the
-- column a sharded deployment needs to exist, with a default that makes
-- every existing row — and every existing INSERT that doesn't mention the
-- column — continue to mean exactly what it already meant.
--
-- Actually splitting across physical shards is an operational step, not a
-- schema one: point each shard's own database at DATABASE_SHARDS, and route
-- tenant-aware reads/writes through `withTenantClient` (apps/web/src/lib/db.ts)
-- instead of `withClient`. Existing call sites are untouched and keep using
-- `withClient` against the one database named by DATABASE_URL. See
-- SHARDING.md for the full rollout plan and what is deliberately not done
-- here (backfilling per-tenant workspace_id values beyond the default,
-- physically provisioning a second database, migrating existing rows to it).

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS workspace_id VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_payments_workspace_id ON payments(workspace_id);

COMMIT;
