/**
 * Fee savings calculator (#419).
 *
 * Shows merchants what Accensa costs versus a traditional card processor
 * (Stripe/Visa-style 2.9% + 30¢). Every figure is computed in integer
 * stroops via `lib/money` — no float ever touches a money value, so the
 * banner's total is exactly the sum of the per-transaction savings.
 *
 * The comparison benchmark is configurable: `traditionalProcessingFee`
 * takes any `{ percent, fixed }` pair, so the same math drives a Stripe
 * comparison today and a Visa/Mastercard tier tomorrow without a rewrite.
 */

import { fromStroops, toStroops } from '@/lib/money';

/**
 * The default card-processor benchmark: 2.9% of the transaction plus a
 * fixed 30¢ per transaction — the standard Stripe/Visa online rate.
 */
export const DEFAULT_CARD_BENCHMARK = { percent: '0.029', fixed: '0.30' } as const;

/** Stellar network base fee per operation: 100 stroops = 0.00001 XLM. */
export const STELLAR_BASE_FEE_STROOPS = 100n;

/** A card-processor fee schedule to compare against. */
export interface FeeBenchmark {
  /** Percent of the transaction amount, as a decimal string (e.g. "0.029"). */
  percent: string;
  /** Fixed fee per transaction, as a decimal string (e.g. "0.30"). */
  fixed: string;
}

/** Accensa's own fee schedule: protocol fee plus Stellar network fees. */
export interface AccensaFeeOptions {
  /** Protocol fee per transaction as a decimal string. Defaults to "0". */
  protocolFee?: string;
  /**
   * Network fee per operation in stroops. Defaults to the Stellar base fee
   * (100 stroops).
   */
  networkFeeStroops?: bigint;
  /** Operations per settlement transaction. Defaults to 1. */
  operations?: number;
}

/** The subset of a settled payment this calculator reads. */
export interface SettledTransaction {
  /** Decimal string from the ledger. */
  amount: string;
  /** ISO 8601 settlement time. */
  ts: string;
}

/** What one transaction costs under each rail, and the difference. */
export interface TransactionSavings {
  amount: string;
  traditionalFee: string;
  accensaFee: string;
  /** traditionalFee - accensaFee, floored at zero. Decimal string. */
  netSavings: string;
}

/** Cumulative savings across a set of settled transactions. */
export interface SavingsSummary {
  /** Transactions counted. */
  transactionCount: number;
  /** Theoretical card-processor fees, all-time. Decimal string. */
  traditionalTotal: string;
  /** Actual Accensa protocol + network fees, all-time. Decimal string. */
  actualTotal: string;
  /** traditionalTotal - actualTotal, all-time. Decimal string. */
  totalSavings: string;
  /** Transactions counted in the current calendar month. */
  monthTransactionCount: number;
  /** Theoretical card-processor fees this month. Decimal string. */
  monthTraditionalTotal: string;
  /** Actual Accensa fees this month. Decimal string. */
  monthActualTotal: string;
  /** Net savings this month — the banner's headline number. Decimal string. */
  monthSavings: string;
}

/** Savings milestones for the shareable badge, in whole currency units. */
export const SAVINGS_MILESTONES = [100, 500, 1000, 5000, 10000] as const;

/**
 * Theoretical card-processing fee for one transaction: `amount * percent +
 * fixed`, floored to the stroop.
 *
 * @throws on a malformed amount or benchmark decimal.
 */
export function traditionalProcessingFee(
  amount: string,
  benchmark: FeeBenchmark = DEFAULT_CARD_BENCHMARK,
): string {
  const amountStroops = toStroops(amount);
  if (amountStroops === null) {
    throw new Error(`SavingsCalculator: invalid amount '${amount}'`);
  }
  const percentStroops = toStroops(benchmark.percent);
  const fixedStroops = toStroops(benchmark.fixed);
  if (percentStroops === null || percentStroops < 0n) {
    throw new Error(`SavingsCalculator: invalid benchmark percent '${benchmark.percent}'`);
  }
  if (fixedStroops === null || fixedStroops < 0n) {
    throw new Error(`SavingsCalculator: invalid benchmark fixed fee '${benchmark.fixed}'`);
  }
  // Integer math throughout: amount * percent / 1 (percent is already in
  // stroops at 7 places, so scale it by 10^7 to match), then the fixed fee.
  const variable = (amountStroops * percentStroops) / 10_000_000n;
  return fromStroops(variable + fixedStroops);
}

/**
 * What Accensa actually charges for one transaction: the protocol fee plus
 * the Stellar network fee (base fee × operations). Defaults to the network
 * fee alone — 100 stroops — because the protocol levies no per-transaction
 * charge in the MVP.
 */
export function accensaProcessingFee(_amount: string, options: AccensaFeeOptions = {}): string {
  const protocolStroops = toStroops(options.protocolFee ?? '0');
  if (protocolStroops === null || protocolStroops < 0n) {
    throw new Error(`SavingsCalculator: invalid protocol fee '${options.protocolFee}'`);
  }
  const baseFee = options.networkFeeStroops ?? STELLAR_BASE_FEE_STROOPS;
  if (baseFee < 0n) {
    throw new Error('SavingsCalculator: network fee cannot be negative');
  }
  const operations = options.operations ?? 1;
  if (!Number.isInteger(operations) || operations < 1) {
    throw new Error(
      `SavingsCalculator: operations must be a positive integer, got '${operations}'`,
    );
  }
  return fromStroops(protocolStroops + baseFee * BigInt(operations));
}

/**
 * Net savings for one transaction: the card-processor fee minus what
 * Accensa actually charged, floored at zero (a transaction can never cost
 * more than the benchmark and produce negative savings).
 */
export function netSavingsForTransaction(
  amount: string,
  benchmark: FeeBenchmark = DEFAULT_CARD_BENCHMARK,
  accensaOptions: AccensaFeeOptions = {},
): TransactionSavings {
  const traditionalFee = traditionalProcessingFee(amount, benchmark);
  const accensaFee = accensaProcessingFee(amount, accensaOptions);
  const traditionalStroops = toStroops(traditionalFee) ?? 0n;
  const accensaStroops = toStroops(accensaFee) ?? 0n;
  return {
    amount,
    traditionalFee,
    accensaFee,
    netSavings: fromStroops(
      traditionalStroops > accensaStroops ? traditionalStroops - accensaStroops : 0n,
    ),
  };
}

/** Midnight UTC of the first day of the month containing `ms`. */
function startOfMonth(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/**
 * Folds a set of settled transactions into cumulative savings, split into
 * all-time and current-calendar-month figures.
 *
 * The month window is aligned to midnight UTC so it is deterministic and
 * testable; `now` is injectable for the same reason. Transactions with an
 * unparseable amount or timestamp are counted but contribute no money —
 * the same honest-degradation rule the revenue aggregations use.
 */
export function summarizeSavings(
  transactions: SettledTransaction[],
  options: { benchmark?: FeeBenchmark; accensa?: AccensaFeeOptions; now?: number } = {},
): SavingsSummary {
  const now = options.now ?? Date.now();
  const monthStart = startOfMonth(now);

  let traditionalTotal = 0n;
  let actualTotal = 0n;
  let monthTraditionalTotal = 0n;
  let monthActualTotal = 0n;
  let monthTransactionCount = 0;

  for (const tx of transactions) {
    let savings: TransactionSavings;
    try {
      savings = netSavingsForTransaction(tx.amount, options.benchmark, options.accensa);
    } catch {
      continue;
    }
    const traditionalStroops = toStroops(savings.traditionalFee) ?? 0n;
    const accensaStroops = toStroops(savings.accensaFee) ?? 0n;
    traditionalTotal += traditionalStroops;
    actualTotal += accensaStroops;

    const ms = Date.parse(tx.ts);
    if (!Number.isNaN(ms) && ms >= monthStart) {
      monthTraditionalTotal += traditionalStroops;
      monthActualTotal += accensaStroops;
      monthTransactionCount += 1;
    }
  }

  const monthSavingsStroops =
    monthTraditionalTotal > monthActualTotal ? monthTraditionalTotal - monthActualTotal : 0n;

  return {
    transactionCount: transactions.length,
    traditionalTotal: fromStroops(traditionalTotal),
    actualTotal: fromStroops(actualTotal),
    totalSavings: fromStroops(traditionalTotal > actualTotal ? traditionalTotal - actualTotal : 0n),
    monthTransactionCount,
    monthTraditionalTotal: fromStroops(monthTraditionalTotal),
    monthActualTotal: fromStroops(monthActualTotal),
    monthSavings: fromStroops(monthSavingsStroops),
  };
}

/**
 * The highest savings milestone reached, or null when the merchant has not
 * passed the first one. Drives the banner's milestone badge.
 */
export function savingsMilestone(savings: string): number | null {
  const stroops = toStroops(savings) ?? 0n;
  let achieved: number | null = null;
  for (const milestone of SAVINGS_MILESTONES) {
    const milestoneStroops = toStroops(milestone.toFixed(2)) ?? 0n;
    if (stroops >= milestoneStroops) achieved = milestone;
  }
  return achieved;
}

/** Formats a decimal string as a display amount with a $ sign: "$1,234.56". */
export function formatSavings(savings: string): string {
  const stroops = toStroops(savings);
  if (stroops === null) return '$0.00';
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  // Round half-up to the cent in integer stroops, so $0.32899 displays as
  // $0.33 the way a merchant expects, not $0.32.
  const cents = (abs * 100n + 5_000_000n) / 10_000_000n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${frac}`;
}
