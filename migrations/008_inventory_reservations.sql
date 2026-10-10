BEGIN;

CREATE TABLE IF NOT EXISTS inventory_items (
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    name VARCHAR(160) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    low_stock_threshold INT NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
    id UUID PRIMARY KEY,
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    checkout_id VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'committed', 'released', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (merchant_id, checkout_id)
);

CREATE TABLE IF NOT EXISTS inventory_reservation_items (
    reservation_id UUID NOT NULL REFERENCES inventory_reservations(id) ON DELETE CASCADE,
    merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (reservation_id, sku),
    FOREIGN KEY (merchant_id, sku) REFERENCES inventory_items(merchant_id, sku) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_expiry
  ON inventory_reservations (merchant_id, expires_at) WHERE status = 'active';

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_items', 'inventory_reservations', 'inventory_reservation_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_merchant_isolation', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (merchant_id = current_setting(''accensa.merchant_id'', true)::int) WITH CHECK (merchant_id = current_setting(''accensa.merchant_id'', true)::int)',
      table_name || '_merchant_isolation', table_name
    );
  END LOOP;
END $$;

COMMIT;