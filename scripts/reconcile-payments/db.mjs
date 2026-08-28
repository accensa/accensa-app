import pg from 'pg';

/**
 * Reads the production `payments` table for one merchant's ledger-derived
 * columns, plus enough of the merchant-reported columns to report them (never
 * to compare them - see trust-boundary.mjs).
 *
 * Read-only: this module issues a single SELECT and nothing else. It must
 * never be given write access, and never writes even when it has it.
 *
 * @returns {Promise<Map<string, object>>} keyed by tx_hash
 */
export async function fetchProductionPayments(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts,
              route, method, request_id, hook_reported_at
       FROM payments`,
    );
    const rows = new Map();
    for (const row of result.rows) {
      rows.set(row.tx_hash, {
        tx_hash: row.tx_hash,
        ledger: row.ledger === null ? null : Number(row.ledger),
        payer: row.payer,
        amount: row.amount === null ? null : String(row.amount),
        asset: row.asset,
        ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
        route: row.route,
        method: row.method,
        request_id: row.request_id,
      });
    }
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}
