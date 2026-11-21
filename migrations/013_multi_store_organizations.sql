BEGIN;

CREATE TABLE IF NOT EXISTS merchant_stores (
    id SERIAL PRIMARY KEY,
    organization_merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    store_merchant_id INT NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_merchant_id, name),
    CHECK (organization_merchant_id <> store_merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_stores_organization
  ON merchant_stores (organization_merchant_id, id);

ALTER TABLE merchant_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_stores_organization_isolation ON merchant_stores;
CREATE POLICY merchant_stores_organization_isolation ON merchant_stores
  USING (organization_merchant_id = current_setting('accensa.merchant_id', true)::int)
  WITH CHECK (organization_merchant_id = current_setting('accensa.merchant_id', true)::int);

CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id UUID PRIMARY KEY,
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(24) NOT NULL,
    secret_hash VARCHAR(64) NOT NULL UNIQUE,
    permissions TEXT[] NOT NULL DEFAULT ARRAY['read'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
ALTER TABLE merchant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_api_keys_merchant_isolation ON merchant_api_keys;
CREATE POLICY merchant_api_keys_merchant_isolation ON merchant_api_keys
  USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
  WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

CREATE TABLE IF NOT EXISTS merchant_catalog_items (
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(30, 12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_id, sku)
);
ALTER TABLE merchant_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_catalog_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_catalog_items_merchant_isolation ON merchant_catalog_items;
CREATE POLICY merchant_catalog_items_merchant_isolation ON merchant_catalog_items
  USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
  WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);

COMMIT;