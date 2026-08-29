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
 * See migrations/005_zk_commitments.sql for the same steps as a standalone SQL
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
  const res = await client.query(
    `INSERT INTO zk_commitments (merchant_id, commitment, payload_hash, proof_scheme)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (merchant_id, commitment) DO NOTHING`,
    [merchantId, c.commitment, c.payloadHash, c.scheme],
  );
  return { recorded: (res.rowCount ?? 0) > 0 };
}
