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

/**
 * Canonical decimal form for an amount: `'10.50'` and `'10.5000000'` both
 * become `'10.5'`. Works on the digit strings rather than going through
 * `parseFloat`, so large values keep their full precision.
 *
 * The chain rebuild always emits 7 fixed decimals (`stroopsToAmount`), while
 * Postgres numeric columns and fixtures may trim trailing zeros. Comparing the
 * raw strings would report those as mismatches (see issue #815).
 */
function normalizeAmount(amount) {
  if (amount === null || amount === undefined || amount === '') return null;
  const text = String(amount).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return text;

  const negative = match[1] === '-';
  const whole = match[2].replace(/^0+(?=\d)/, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

/** Every comparison goes through the same normalization so the report agrees with `columnsEqual`. */
function normalizeColumn(column, value) {
  if (column === 'ledger') return normalizeLedger(value);
  if (column === 'amount') return normalizeAmount(value);
  if (column === 'ts') return normalizeTs(value);
  return value;
}

/** Compares only the ledger-derived columns; the reconciliation's contract never touches the rest. */
function columnsEqual(a, b) {
  return RECONSTRUCTED_COLUMNS.every(
    (column) => normalizeColumn(column, a[column]) === normalizeColumn(column, b[column]),
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
          if (normalizeColumn(col, chainRow[col]) !== normalizeColumn(col, dbRow[col])) {
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
