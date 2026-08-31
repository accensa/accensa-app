-- 007_role_tuples.sql
--
-- Persists the Zanzibar relationship tuples (#180) so the in-process store is
-- no longer memory-only: role grants survive deploys and are visible to every
-- replica. The schema mirrors what the dashboard's membership UI writes.
--
-- A tuple is (object, relation, user), e.g.
--   merchant:12#owner@user:u_abc
--   merchant:12#viewer@group:ops#member
--
-- `merchant_id` is the tenant scope for the relationship (the merchant the
-- role is defined on), kept as its own column so row-level security works
-- exactly like `payments`: with FORCE RLS, a connection scoped to one merchant
-- can only read and write that merchant's tuples, even if a query forgets its
-- WHERE clause.
--
-- `user` is a string like `user:u_abc` or `group:ops#member` — the full
-- Zanzibar "userset" form is stored verbatim so a SpiceDB cluster can be
-- seeded from this table without re-deriving anything.
--
-- Applied automatically by ensureSchema(); committed here for documentation
-- and for anyone restoring a database outside the app.

BEGIN;

CREATE TABLE IF NOT EXISTS role_tuples (
    object      TEXT NOT NULL,                -- merchant:<id>
    relation    TEXT NOT NULL,                -- owner | editor | viewer | member
    "user"      TEXT NOT NULL,                -- user:<id> | group:<id>#member
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (object, relation, "user")
);

CREATE INDEX IF NOT EXISTS idx_role_tuples_merchant
  ON role_tuples (merchant_id);

ALTER TABLE role_tuples ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_tuples FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_tuples_merchant_isolation ON role_tuples;
CREATE POLICY role_tuples_merchant_isolation ON role_tuples
    USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
    WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

COMMIT;

-- ============================== DOWN ==============================
-- Not executed automatically. Run by hand to roll back.
--
-- BEGIN;
-- DROP TABLE IF EXISTS role_tuples;
-- COMMIT;