-- Outbound payment webhooks, queued in the same transaction as the payment
-- insert and delivered by GET /api/webhooks/deliver. Applied automatically
-- by ensureSchema(); this file is the readable form.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  payment_tx_hash VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_status_code INT,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_tx_hash, url)
);

CREATE TABLE IF NOT EXISTS webhook_attempts (
  id BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status_code INT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries (next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries (status);
