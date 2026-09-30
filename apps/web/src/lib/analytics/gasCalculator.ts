/**
 * Gas & network fee expenditure analytics (#435).
 *
 * Aggregates the Stellar network fees a merchant has actually paid across
 * settled transactions: total spent, average per transaction, the fee-to-
 * volume ratio, and the per-day series the chart renders.
 *
 * Two rules run through it, matching the other analytics modules:
 *
 * 1. Fees are summed in integer stroops via bigint. The one float is the
 *    fee-to-volume *ratio*, which is a display proportion, never a value.
 * 2. Nothing here trusts its input. Receipt-shaped entries are parsed
 *    through {@link parseGasFeeLogEntry}, which rejects anything malformed
 *    rather than folding a bad row into a total quietly.
 *
 * The per-transaction network fee is currently the Stellar base fee (100
 * stroops per operation); when the indexer captures actual `fee_charged`
 * from transaction receipts, the parser accepts it directly.
 */

import { CSV_BOM, toCsvRow } from '@/lib/payments-csv';
import { fromStroops, toStroops } from '@/lib/money';

/** Stellar network base fee per operation: 100 stroops = 0.00001 XLM. */
export const STELLAR_BASE_FEE_STROOPS = 100n;

/**
 * One transaction's network fee, as parsed from a receipt.
 *
 * `feeStroops` is the authoritative field; `amount` is the settled amount
 * the fee was paid on, present so the fee-to-volume ratio can be computed.
 */
export interface GasFeeLogEntry {
  txHash: string;
  ledger: number | null;
  /** Network fee paid, in stroops. */
  feeStroops: bigint;
  /** ISO 8601 settlement time. */
  timestamp: string;
  /** Settled amount as a decimal string, when known. */
  amount: string | null;
}

/** A receipt-shaped record as it arrives from an indexer or API. */
export interface GasReceiptInput {
  txHash?: unknown;
  ledger?: unknown;
  /** Fee in stroops: a number or a decimal/integer string. */
  fee?: unknown;
  timestamp?: unknown;
  amount?: unknown;
}

/**
 * Parses one receipt-shaped record into a validated fee log entry.
 *
 * @throws when a field is missing or malformed — a receipt that cannot be
 *   read must never become a zero-fee row that quietly deflates the total.
 */
export function parseGasFeeLogEntry(receipt: GasReceiptInput): GasFeeLogEntry {
  const txHash = typeof receipt.txHash === 'string' ? receipt.txHash : '';
  if (!txHash) {
    throw new Error('GasCalculator: receipt is missing txHash');
  }

  const ledger =
    receipt.ledger === null || receipt.ledger === undefined ? null : Number(receipt.ledger);
  if (
    receipt.ledger !== null &&
    receipt.ledger !== undefined &&
    (!Number.isInteger(ledger) || (ledger as number) < 0)
  ) {
    throw new Error(`GasCalculator: receipt ${txHash} has an invalid ledger`);
  }

  // The fee is an integer stroop count, not an XLM decimal — parsing it via
  // toStroops would scale it by 10^7.
  const feeRaw = typeof receipt.fee === 'number' ? receipt.fee : receipt.fee;
  if (typeof feeRaw !== 'number' && typeof feeRaw !== 'string') {
    throw new Error(`GasCalculator: receipt ${txHash} is missing a fee`);
  }
  if (typeof feeRaw === 'number' && (!Number.isInteger(feeRaw) || feeRaw < 0)) {
    throw new Error(`GasCalculator: receipt ${txHash} has an invalid fee`);
  }
  if (typeof feeRaw === 'string' && !/^\d+$/.test(feeRaw.trim())) {
    throw new Error(`GasCalculator: receipt ${txHash} has an invalid fee`);
  }
  const feeStroops = BigInt(typeof feeRaw === 'number' ? feeRaw : feeRaw.trim());

  const timestamp = typeof receipt.timestamp === 'string' ? receipt.timestamp : '';
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`GasCalculator: receipt ${txHash} has an invalid timestamp`);
  }

  const amount =
    typeof receipt.amount === 'string' && toStroops(receipt.amount) !== null
      ? receipt.amount
      : null;

  return { txHash, ledger, feeStroops, timestamp, amount };
}

/** One day's aggregated network fees, for the chart. */
export interface GasDayBucket {
  /** Midnight UTC of the day, ISO 8601. */
  day: string;
  /** Short axis label, e.g. "Sep 12". */
  label: string;
  /** Fees paid that day, in stroops. */
  totalStroops: bigint;
  transactions: number;
  /** Height ratio against the tallest bucket. Geometry only. */
  fraction: number;
}

export interface GasAggregate {
  /** Total network fees paid, in stroops. */
  totalStroops: bigint;
  transactions: number;
  /** Mean fee per transaction in stroops, floored. Null when no transactions. */
  averageStroopsPerTx: bigint | null;
  /** Total settled volume in stroops, when amounts were known. */
  volumeStroops: bigint;
  /** Fees as a share of volume; null when there is no volume. Display only. */
  feeToVolumeRatio: number | null;
  /** Per-day buckets, oldest first, gaps filled with zero-fee days. */
  buckets: GasDayBucket[];
  /** Tallest bucket's fee total, in stroops. Drives the y-axis label. */
  maxStroops: bigint;
}

const DAY_MS = 86_400_000;

/** Midnight UTC of the day containing `ms`. */
function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Aggregates fee log entries into the dashboard's metrics and chart series.
 *
 * Days with no transactions are emitted as zero-fee buckets rather than
 * skipped: a quiet day is a fact about the network spend, and dropping it
 * would compress the x-axis into a shape that implies steadier cost.
 *
 * @throws when any entry is malformed — aggregation never silently drops
 *   a bad row.
 */
export function aggregateGasFees(entries: GasFeeLogEntry[]): GasAggregate {
  const totalStroops = entries.reduce((sum, entry) => sum + entry.feeStroops, 0n);
  const volumeStroops = entries.reduce(
    (sum, entry) => sum + (entry.amount === null ? 0n : (toStroops(entry.amount) ?? 0n)),
    0n,
  );

  interface DayCell {
    total: bigint;
    calls: number;
  }
  const days = new Map<number, DayCell>();
  for (const entry of entries) {
    const dayMs = startOfDay(Date.parse(entry.timestamp));
    let cell = days.get(dayMs);
    if (!cell) {
      cell = { total: 0n, calls: 0 };
      days.set(dayMs, cell);
    }
    cell.total += entry.feeStroops;
    cell.calls += 1;
  }

  // An empty log has no span at all: zero buckets, so the chart renders its
  // empty state rather than a single meaningless zero-fee day.
  if (entries.length === 0) {
    return {
      totalStroops: 0n,
      transactions: 0,
      averageStroopsPerTx: null,
      volumeStroops: 0n,
      feeToVolumeRatio: null,
      buckets: [],
      maxStroops: 0n,
    };
  }

  // Span from the first paid fee to the newest entry.
  const stamps = entries.map((entry) => Date.parse(entry.timestamp));
  const earliest = Math.min(...stamps);
  const latest = Math.max(...stamps);

  let maxStroops = 0n;
  for (const cell of days.values()) {
    if (cell.total > maxStroops) maxStroops = cell.total;
  }

  const cells: GasDayBucket[] = [];
  for (let ms = startOfDay(earliest); ms <= startOfDay(latest); ms += DAY_MS) {
    const cell = days.get(ms) ?? { total: 0n, calls: 0 };
    const date = new Date(ms);
    cells.push({
      day: date.toISOString(),
      label: date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      totalStroops: cell.total,
      transactions: cell.calls,
      // Ratio at 1/10000 resolution, divided in bigint first — the fraction
      // is a pixel measurement, never a fee value.
      fraction: maxStroops > 0n ? Number((cell.total * 10_000n) / maxStroops) / 10_000 : 0,
    });
  }

  return {
    totalStroops,
    transactions: entries.length,
    averageStroopsPerTx: entries.length > 0 ? totalStroops / BigInt(entries.length) : null,
    volumeStroops,
    feeToVolumeRatio: volumeStroops > 0n ? Number(totalStroops) / Number(volumeStroops) : null,
    buckets: cells,
    maxStroops,
  };
}

/** Formats stroops as an XLM decimal string, e.g. 100 stroops → "0.00001". */
export function stroopsToXlm(stroops: bigint): string {
  return fromStroops(stroops);
}

/**
 * Formats the fee-to-volume ratio as a percentage string.
 *
 * The ratio is tiny by nature (100 stroops on a 10 XLM payment is 0.0001%),
 * so it is shown with enough decimals to stay non-zero rather than the two
 * a currency amount would get.
 */
export function formatFeeToVolumeRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  if (ratio === 0) return '0%';
  // Compare the ratio, not the percent: 1e-6 * 100 lands below 0.0001 in
  // float and would take the "<" branch when it is exactly the threshold.
  if (ratio < 0.000001) return '<0.0001%';
  return `${(ratio * 100).toFixed(4)}%`;
}

/**
 * What a traditional card processor (2.9% + 30¢) would have charged on the
 * same settled volume — the comparison that makes the gas figure meaningful.
 *
 * Computed locally rather than imported from the savings calculator so this
 * module stays self-contained.
 */
export function traditionalCardFeeForVolume(volumeStroops: bigint): bigint {
  const variable = (volumeStroops * 29n) / 1000n;
  return variable + 3_000_000n; // 30¢ in stroops
}

/** CSV header row for the gas expenditure log. */
const GAS_CSV_HEADERS = [
  'Transaction Hash',
  'Ledger',
  'Timestamp',
  'Fee (stroops)',
  'Fee (XLM)',
  'Amount',
];

/**
 * Serializes the fee log to CSV text, header row included.
 *
 * An empty set still returns the header, so the download is a valid CSV
 * with named columns rather than a zero-byte file that reads as a failure.
 * Reuses the payments CSV escaping so formula injection is defused there too.
 */
export function gasLogToCsv(entries: GasFeeLogEntry[]): string {
  const rows = entries.map((entry) =>
    toCsvRow([
      entry.txHash,
      entry.ledger === null ? '' : String(entry.ledger),
      entry.timestamp,
      entry.feeStroops.toString(),
      stroopsToXlm(entry.feeStroops),
      entry.amount ?? '',
    ]),
  );
  return [toCsvRow(GAS_CSV_HEADERS), ...rows].join('\r\n') + '\r\n';
}

/** `accensa_gas_fees_2026-09-15.csv`, dated in the viewer's own timezone. */
export function gasCsvFilename(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `accensa_gas_fees_${year}-${month}-${day}.csv`;
}

/** Prepends the UTF-8 BOM so Excel reads the export correctly. */
export function gasCsvExport(entries: GasFeeLogEntry[]): string {
  return CSV_BOM + gasLogToCsv(entries);
}
