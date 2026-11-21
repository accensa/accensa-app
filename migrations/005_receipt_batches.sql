-- Mapping from an on-chain ReceiptAnchor batch to the payments that formed it.
-- Applied automatically by ensureSchema(); this file is the readable form.

CREATE TABLE IF NOT EXISTS receipt_batches (
  selection_hash VARCHAR(64) PRIMARY KEY,
  batch_id BIGINT UNIQUE,
  root VARCHAR(64) NOT NULL,
  count INT NOT NULL,
  period_start BIGINT NOT NULL,
  period_end BIGINT NOT NULL,
  start_ledger BIGINT NOT NULL,
  end_ledger BIGINT NOT NULL,
  anchor_tx VARCHAR(64),
  status VARCHAR(20) NOT NULL,
  proofs JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS batch_id BIGINT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_leaf VARCHAR(64);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_proof JSONB;
CREATE INDEX IF NOT EXISTS idx_payments_batch_id ON payments(batch_id);
