import { RECONSTRUCTED_COLUMNS } from './trust-boundary.mjs';

/**
 * @typedef {{tx_hash: string, ledger: number|null, payer: string|null, amount: string|null, asset: string|null, ts: string|null}} PaymentColumns
 */

function normalizeTs(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? String(ts) : date.toISOString();
}

function normalizeLedger(ledger) {
  if (ledger === null || ledger === undefined) return null;
  return Number(ledger);
}

/** Compares only the ledger-derived columns; the reconciliation's contract never touches the rest. */
function columnsEqual(a, b) {
  return (
    normalizeLedger(a.ledger) === normalizeLedger(b.ledger) &&
    a.payer === b.payer &&
    a.amount === b.amount &&
    a.asset === b.asset &&
    normalizeTs(a.ts) === normalizeTs(b.ts)
  );
}

/**
 * Row-level diff between the chain rebuild and the production `payments`
 * table, restricted to the ledger-derived columns.
 *
 * Deliberately never reduces to a count: a row-level report is the entire
 * point (see issue #170 - "a matching count with mismatched amounts is the
 * failure this is meant to catch").
 *
 * A production row with `ledger === null` is a merchant-reported row staged
 * ahead of indexing (see db.ts's `recordSettlement`) - not yet a chain fact,
 * so it is reported separately as `pendingOnChain` rather than as a mismatch.
 *
 * @param {Map<string, PaymentColumns>} rebuilt keyed by tx_hash
 * @param {Map<string, PaymentColumns>} production keyed by tx_hash
 */
export function diffPayments(rebuilt, production) {
  const mismatched = [];
  const missingInDb = [];
  const missingOnChain = [];
  const pendingOnChain = [];
  let matched = 0;

  const allHashes = new Set([...rebuilt.keys(), ...production.keys()]);
  for (const txHash of allHashes) {
    const chainRow = rebuilt.get(txHash);
    const dbRow = production.get(txHash);

    if (chainRow && !dbRow) {
      missingInDb.push({ tx_hash: txHash, chain: chainRow });
      continue;
    }

    if (!chainRow && dbRow) {
      if (dbRow.ledger === null || dbRow.ledger === undefined) {
        // Staged by the merchant hook, not yet observed on chain by this
        // reconstruction. Not proof of anything wrong on its own - it may
        // simply not have settled, or fall before `fromLedger`.
        pendingOnChain.push({ tx_hash: txHash, db: dbRow });
      } else {
        // The database claims a ledger position this chain walk never saw.
        // With a full-range rebuild this is a real discrepancy.
        missingOnChain.push({ tx_hash: txHash, db: dbRow });
      }
      continue;
    }

    if (chainRow && dbRow) {
      if (columnsEqual(chainRow, dbRow)) {
        matched++;
      } else {
        const columns = {};
        for (const col of RECONSTRUCTED_COLUMNS) {
          const chainVal = col === 'ts' ? normalizeTs(chainRow[col]) : chainRow[col];
          const dbVal = col === 'ts' ? normalizeTs(dbRow[col]) : dbRow[col];
          const norm =
            col === 'ledger'
              ? [normalizeLedger(chainRow[col]), normalizeLedger(dbRow[col])]
              : [chainVal, dbVal];
          if (norm[0] !== norm[1]) {
            columns[col] = { chain: chainRow[col], db: dbRow[col] };
          }
        }
        mismatched.push({ tx_hash: txHash, columns });
      }
    }
  }

  return {
    matched,
    mismatched,
    missingInDb,
    missingOnChain,
    pendingOnChain,
    ok: mismatched.length === 0 && missingInDb.length === 0 && missingOnChain.length === 0,
  };
}
