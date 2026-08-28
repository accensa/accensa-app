import type { Client } from 'pg';

/**
 * Historical merchant configuration tracking (indexer-side).
 *
 * `merchant_config_events` records every change to a merchant's store
 * configuration so the team can answer "what was this merchant's fee/status
 * at time T?" instead of only seeing the current profile. The table is
 * created on demand here rather than in the shared `ensureSchema` so this
 * module stays self-contained and additive.
 *
 * Both writers are wired in: the dashboard's profile PATCH (a direct,
 * off-chain configuration change) and, in a companion change on the sync
 * path, on-chain configuration events once the indexer observes them. Every
 * row is an immutable append - the active profile in `merchants` is always
 * the latest value, and this table is the audit trail behind it.
 */

export interface MerchantConfigChange {
  merchantId: number;
  /** The field that changed, e.g. `webhook_url` or `asset_contract_ids`. */
  field: string;
  /** The new value after the change, or `__cleared__` when nulled. */
  before: string | null;
  after: string | null;
  /** Who/what made the change: `profile_patch`, `indexer_event`, … */
  source: string;
  occurredAt: Date;
}

interface ConfigEventRow {
  id: number;
  merchant_id: number;
  field: string;
  before: string | null;
  after: string | null;
  source: string;
  occurred_at: Date;
}

async function ensureConfigTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_config_events (
      id          SERIAL PRIMARY KEY,
      merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      field       TEXT NOT NULL,
      before      TEXT,
      after       TEXT,
      source      TEXT NOT NULL DEFAULT 'profile_patch',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS merchant_config_events_merchant_idx
      ON merchant_config_events (merchant_id, occurred_at DESC);
  `);
}

/** Appends a configuration-change record to the audit history. */
export async function recordMerchantConfigChange(
  client: Client,
  change: Omit<MerchantConfigChange, 'occurredAt'> & { occurredAt?: Date },
): Promise<void> {
  await ensureConfigTable(client);
  await client.query(
    `INSERT INTO merchant_config_events (merchant_id, field, before, after, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      change.merchantId,
      change.field,
      change.before,
      change.after,
      change.source,
      change.occurredAt ?? new Date(),
    ],
  );
}

/** The most recent configuration-change events for a merchant, newest first. */
export async function listMerchantConfigHistory(
  client: Client,
  merchantId: number,
  opts: { limit?: number } = {},
): Promise<MerchantConfigChange[]> {
  await ensureConfigTable(client);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const res = await client.query<ConfigEventRow>(
    `SELECT id, merchant_id, field, before, after, source, occurred_at
     FROM merchant_config_events
     WHERE merchant_id = $1
     ORDER BY occurred_at DESC, id DESC
     LIMIT $2`,
    [merchantId, limit],
  );
  return res.rows.map((row) => ({
    merchantId: row.merchant_id,
    field: row.field,
    before: row.before,
    after: row.after,
    source: row.source,
    occurredAt: row.occurred_at,
  }));
}
