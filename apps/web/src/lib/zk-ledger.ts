import type { Client } from 'pg';

/**
 * ZK commitment ledger (#173).
 *
 * The sync API's proof endpoint verifies an opening proof entirely in memory,
 * then records *only* the commitment and a one-way hash of the canonical
 * payload here — never the plaintext, so a leaked table exposes nothing about
 * the underlying data. This module owns that table's schema and the single
 * write path into it.
 */

/**
 * Creates the `zk_commitments` ledger schema (#173).
 *
 * See migrations/009_zk_commitments.sql for the same steps as a standalone SQL
 * file. Called defensively at the top of the proofs route, the same way
 * `ensureSchema` runs at the top of every DB-touching handler. Idempotent.
 */
export async function ensureZkCommitmentsSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS zk_commitments (
      id            BIGSERIAL PRIMARY KEY,
      merchant_id   INT NOT NULL REFERENCES merchants(id),
      commitment    TEXT NOT NULL,
      payload_hash  TEXT NOT NULL,
      proof_scheme  TEXT NOT NULL DEFAULT 'sha256-commitment-opening',
      verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT zk_commitments_unique_commitment
        UNIQUE (merchant_id, commitment)
    );
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS idx_zk_commitments_merchant_verified
       ON zk_commitments (merchant_id, verified_at DESC);`,
  );
  // Isolation, same shape as payments/sync_state (migrations/004_multi_merchant.sql),
  // role_tuples and the merchant_* tables: FORCE binds even the table owner —
  // the role this app connects as — so a query without the merchant scope
  // reads nothing instead of every merchant's commitments. DROP POLICY first
  // keeps this re-run safe, as migrations/013 does.
  await client.query(`ALTER TABLE zk_commitments ENABLE ROW LEVEL SECURITY;`);
  await client.query(`ALTER TABLE zk_commitments FORCE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS zk_commitments_merchant_isolation ON zk_commitments;`);
  await client.query(`
    CREATE POLICY zk_commitments_merchant_isolation ON zk_commitments
      USING (merchant_id = current_setting('accensa.merchant_id', true)::int)
      WITH CHECK (merchant_id = current_setting('accensa.merchant_id', true)::int);
  `);
}

/**
 * Records a verified zero-knowledge commitment.
 *
 * Called by the sync API *after* the proof has been verified — this function
 * only persists the commitment and a one-way hash of the canonical payload,
 * never the plaintext. Idempotent per (merchant, commitment): re-submitting
 * the same verified transition is a no-op, not a duplicate.
 *
 * @returns Whether this was a new commitment (`true`) or an already-recorded
 *   one (`false`).
 */
export async function recordVerifiedCommitment(
  client: Client,
  merchantId: number,
  c: { commitment: string; payloadHash: string; scheme: string },
): Promise<{ recorded: boolean }> {
  // FORCE ROW LEVEL SECURITY (set up by ensureZkCommitmentsSchema) binds this
  // connection too, and the proofs route resolves the merchant from the
  // session *without* ever setting the `accensa.merchant_id` GUC the policy
  // reads — so scope the session to the merchant this write is for, but only
  // if nothing scoped it already. A connection already bound to a different
  // merchant stays bound: the policy, not this function, then refuses the
  // write (#508 is the precedent for leaving this to chance).
  const scope = await client.query<{ value: string | null }>(
    `SELECT current_setting('accensa.merchant_id', true) AS value`,
  );
  if (!scope.rows[0]?.value) {
    await client.query('SELECT set_config($1, $2, false)', [
      'accensa.merchant_id',
      String(merchantId),
    ]);
  }

  const res = await client.query(
    `INSERT INTO zk_commitments (merchant_id, commitment, payload_hash, proof_scheme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant_id, commitment) DO NOTHING`,
    [merchantId, c.commitment, c.payloadHash, c.scheme],
  );
  return { recorded: (res.rowCount ?? 0) > 0 };
}
