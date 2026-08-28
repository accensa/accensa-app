/**
 * Aggregations behind the merchant analytics view: revenue by route, and
 * revenue over time.
 *
 * Two rules run through all of it.
 *
 * 1. Money never touches a float. Every total is folded in integer stroops via
 *    bigint and converted to a decimal string only at the edge. The one number
 *    that does become a float is a *fraction* used for chart geometry, and it
 *    is derived by dividing bigints first - it is a pixel ratio, never a value.
 *
 * 2. Attribution is merchant-reported, revenue is chain-indexed. A route on a
 *    payment arrives from the seller's own process via /api/hook/settle; the
 *    amount arrives from the ledger. A payment with no route is a real transfer
 *    that simply has no attribution, so it is kept in its own bucket and
 *    counted in every total - never folded into a route, never dropped.
 *
 * A third rule falls out of the first: amounts are only ever summed within a
 * single asset. Adding 10 XLM to 10 USDC produces a number that means nothing,
 * so callers pick an asset and the aggregations work inside it.
 */

import { assetLabel, fromStroops, toStroops } from './money';

/** The subset of a payment row these aggregations read. */
export interface RevenuePayment {
  /** Decimal string from the ledger. May be absent on a malformed row. */
  amount: string | null;
  /** SEP-11 asset identifier; null means the native asset. */
  asset: string | null;
  /** ISO 8601. Chain-indexed rows always have one. */
  ts: string;
  /** Merchant-reported. Null when the transfer carries no attribution. */
  route: string | null;
  /** Merchant-reported. */
  method: string | null;
}

/** Label for the bucket holding payments with no merchant attribution. */
export const UNATTRIBUTED_LABEL = '(unattributed)';

/**
 * Shape returned by `GET /api/analytics/revenue`: the assets a merchant has
 * earned in, and — keyed by asset — the per-day revenue buckets and the
 * per-`(method, route)` breakdown, all summed in SQL.
 */
export interface RevenueAnalyticsResponse {
  assets: AssetOption[];
  days: Record<string, RevenueDayBucket[]>;
  routes: Record<string, RouteAggregate[]>;
}

/* ------------------------------------------------------------------ assets */

/**
 * Stable grouping key for an asset.
 *
 * Deliberately the raw SEP-11 identifier rather than the display code: two
 * different issuers can both call their asset USDC, and merging them would sum
 * money across genuinely different assets.
 */
export function assetKey(asset: string | null): string {
  return asset ?? 'native';
}

export interface AssetOption {
  /** Value to pass back into the aggregations. */
  key: string;
  /** Display label, disambiguated by issuer if two assets share a code. */
  label: string;
  /** How many payments are denominated in it. */
  calls: number;
}

function shortIssuer(issuer: string): string {
  return issuer.length <= 12 ? issuer : `${issuer.slice(0, 4)}…${issuer.slice(-4)}`;
}

/** The assets present in a set of payments, most-used first. */
export function assetOptions(payments: RevenuePayment[]): AssetOption[] {
  const calls = new Map<string, number>();
  for (const payment of payments) {
    const key = assetKey(payment.asset);
    calls.set(key, (calls.get(key) ?? 0) + 1);
  }
  return assetOptionsFromCounts(
    [...calls.entries()].map(([key, count]) => ({ key, calls: count })),
  );
}

/**
 * Asset selector options from pre-counted `(assetKey, calls)` pairs — the
 * shape a server-side `GROUP BY asset` produces. Labels are disambiguated by
 * issuer only when two assets share a display code.
 */
export function assetOptionsFromCounts(counts: { key: string; calls: number }[]): AssetOption[] {
  const labels = new Map<string, number>();
  for (const { key } of counts) {
    const label = assetLabel(key);
    labels.set(label, (labels.get(label) ?? 0) + 1);
  }

  return counts
    .map(({ key, calls }): AssetOption => {
      const base = assetLabel(key);
      const issuer = key.includes(':') ? key.split(':')[1] : '';
      const ambiguous = (labels.get(base) ?? 0) > 1 && issuer !== '';
      return { key, label: ambiguous ? `${base} (${shortIssuer(issuer)})` : base, calls };
    })
    .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label));
}

export function filterByAsset(payments: RevenuePayment[], asset: string): RevenuePayment[] {
  return payments.filter((payment) => assetKey(payment.asset) === asset);
}

/* ----------------------------------------------------------------- helpers */

/**
 * Ratio of two stroop amounts as a float in [0, 1], for chart geometry only.
 *
 * The division happens in bigint at 1/10000 resolution before anything becomes
 * a Number, so no amount is ever represented as a float - only the resulting
 * proportion, which is a pixel measurement rather than money.
 */
export function fraction(value: bigint, max: bigint, resolution = 10_000n): number {
  if (max <= 0n || value <= 0n) return 0;
  if (value >= max) return 1;
  return Number((value * resolution) / max) / Number(resolution);
}

/** Parses an amount, treating an unreadable or missing one as unpriced. */
function priceOf(amount: string | null): bigint | null {
  if (typeof amount !== 'string') return null;
  return toStroops(amount);
}

/* --------------------------------------------------------- route breakdown */

export interface RouteBucket {
  /** Stable React key. */
  key: string;
  /** Merchant-reported route, or null for the unattributed bucket. */
  route: string | null;
  method: string | null;
  /** False only for the unattributed bucket. */
  attributed: boolean;
  /** Payments in the bucket, including any whose amount could not be read. */
  calls: number;
  /** Payments that contributed to `total`. */
  priced: number;
  /** Payments counted but not priced, because their amount was unreadable. */
  unpriced: number;
  /** Exact decimal string. */
  total: string;
  /** Exact decimal string, floored to the stroop. Null when nothing is priced. */
  average: string | null;
  /** Share of all revenue in this asset, attributed or not. Geometry only. */
  share: number;
}

export interface RouteBreakdown {
  /** The asset every figure below is denominated in. */
  asset: string;
  /** Attributed routes, highest revenue first. */
  routes: RouteBucket[];
  /** Payments with no merchant attribution. Null when there are none. */
  unattributed: RouteBucket | null;
  /** Every payment in the asset, attributed or not. */
  total: string;
  attributedTotal: string;
  unattributedTotal: string;
  calls: number;
  attributedCalls: number;
  unattributedCalls: number;
  unpricedCalls: number;
}

interface Accumulator {
  route: string | null;
  method: string | null;
  stroops: bigint;
  calls: number;
  priced: number;
}

/**
 * One `(method, route)` group's revenue in a single asset, already summed.
 *
 * The shape a server-side `GROUP BY method, route` produces (see
 * `/api/analytics/revenue`). `route` is null/empty for the transfers that
 * carry no merchant attribution; every such row folds into one bucket.
 */
export interface RouteAggregate {
  method: string | null;
  route: string | null;
  /** Decimal string — `sum(amount)` for the group. */
  total: string;
  /** Rows in the group. */
  calls: number;
  /** Rows in the group with a readable amount — `count(amount)`. */
  priced: number;
}

/**
 * Folds payments into one bucket per (method, route) pair.
 *
 * Payments with a null route are never merged into a route bucket and never
 * discarded: they land in `unattributed`, which the caller is expected to show
 * alongside the routes. That bucket is the honest answer to "how much of this
 * revenue does Path B actually explain".
 *
 * Held for callers with the raw rows and for tests; it folds them into
 * {@link RouteAggregate}s and defers to {@link routeBreakdownFromAggregates}.
 */
export function buildRouteBreakdown(payments: RevenuePayment[], asset: string): RouteBreakdown {
  const groups = new Map<string, Accumulator>();

  for (const payment of filterByAsset(payments, asset)) {
    const stroops = priceOf(payment.amount);
    const attributed = typeof payment.route === 'string' && payment.route !== '';
    const key = attributed ? `${payment.method ?? ''} ${payment.route}` : ' unattributed';

    let acc = groups.get(key);
    if (!acc) {
      acc = {
        route: attributed ? payment.route : null,
        method: attributed ? payment.method : null,
        stroops: 0n,
        calls: 0,
        priced: 0,
      };
      groups.set(key, acc);
    }
    acc.calls += 1;
    if (stroops !== null) {
      acc.stroops += stroops;
      acc.priced += 1;
    }
  }

  const aggregates: RouteAggregate[] = [...groups.values()].map((acc) => ({
    method: acc.method,
    route: acc.route,
    total: fromStroops(acc.stroops),
    calls: acc.calls,
    priced: acc.priced,
  }));

  return routeBreakdownFromAggregates(aggregates, asset);
}

/**
 * Builds the route breakdown from pre-aggregated `(method, route)` groups.
 *
 * Rows with a null/empty route are folded into a single unattributed bucket
 * regardless of method — the method alone says nothing about which endpoint
 * earned the money.
 */
export function routeBreakdownFromAggregates(
  aggregates: RouteAggregate[],
  asset: string,
): RouteBreakdown {
  const buckets = new Map<string, Accumulator>();
  let unattributed: Accumulator | null = null;
  let total = 0n;
  let calls = 0;
  let unpricedCalls = 0;

  for (const row of aggregates) {
    const stroops = toStroops(row.total) ?? 0n;
    const unpriced = Math.max(0, row.calls - row.priced);
    calls += row.calls;
    unpricedCalls += unpriced;
    total += stroops;

    const attributed = typeof row.route === 'string' && row.route !== '';
    let bucket: Accumulator;
    if (!attributed) {
      unattributed ??= { route: null, method: null, stroops: 0n, calls: 0, priced: 0 };
      bucket = unattributed;
    } else {
      const key = `${row.method ?? ''} ${row.route}`;
      const existing = buckets.get(key);
      if (existing) {
        bucket = existing;
      } else {
        bucket = { route: row.route, method: row.method, stroops: 0n, calls: 0, priced: 0 };
        buckets.set(key, bucket);
      }
    }
    bucket.calls += row.calls;
    bucket.priced += row.priced;
    bucket.stroops += stroops;
  }

  const toBucket = (key: string, acc: Accumulator, attributed: boolean): RouteBucket => ({
    key,
    route: acc.route,
    method: acc.method,
    attributed,
    calls: acc.calls,
    priced: acc.priced,
    unpriced: acc.calls - acc.priced,
    total: fromStroops(acc.stroops),
    // Integer division, so the average is floored to the stroop rather than
    // rounded through a float.
    average: acc.priced > 0 ? fromStroops(acc.stroops / BigInt(acc.priced)) : null,
    share: fraction(acc.stroops, total),
  });

  const routes = [...buckets.entries()]
    .map(([key, acc]) => toBucket(key, acc, true))
    .sort((a, b) => {
      const left = toStroops(a.total) ?? 0n;
      const right = toStroops(b.total) ?? 0n;
      if (left !== right) return right > left ? 1 : -1;
      if (a.calls !== b.calls) return b.calls - a.calls;
      return `${a.route}`.localeCompare(`${b.route}`);
    });

  const unattributedBucket = unattributed
    ? toBucket(UNATTRIBUTED_LABEL, unattributed, false)
    : null;

  const attributedStroops = routes.reduce((sum, r) => sum + (toStroops(r.total) ?? 0n), 0n);

  return {
    asset,
    routes,
    unattributed: unattributedBucket,
    total: fromStroops(total),
    attributedTotal: fromStroops(attributedStroops),
    unattributedTotal: fromStroops(total - attributedStroops),
    calls,
    attributedCalls: routes.reduce((sum, r) => sum + r.calls, 0),
    unattributedCalls: unattributedBucket?.calls ?? 0,
    unpricedCalls,
  };
}

/* ------------------------------------------------------------- time series */

export type RangeKey = '7d' | '30d' | 'all';
export type Granularity = 'day' | 'week';

export const RANGE_DAYS: Record<RangeKey, number | null> = { '7d': 7, '30d': 30, all: null };

const DAY_MS = 86_400_000;

/** Midnight UTC of the day containing `ms`. */
function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Midnight UTC of the Monday on or before `ms`. 1970-01-01 was a Thursday. */
function startOfWeek(ms: number): number {
  const day = startOfDay(ms);
  const weekday = (Math.floor(day / DAY_MS) + 3) % 7; // 0 = Monday
  return day - weekday * DAY_MS;
}

function bucketStart(ms: number, granularity: Granularity): number {
  return granularity === 'week' ? startOfWeek(ms) : startOfDay(ms);
}

/**
 * The payments inside `range`, counting back from `now`.
 *
 * The window start is aligned to midnight UTC so it matches `buildRevenueSeries`,
 * which buckets by UTC day: the earliest payment the route breakdown counts is
 * the same one the chart shows in its first bucket. `'all'` returns the input
 * untouched. Future-dated rows (ledger clock skew) are kept — they are real
 * revenue — even though the chart's fixed geometry has to drop them.
 */
export function filterByRange(
  payments: RevenuePayment[],
  range: RangeKey,
  now: number = Date.now(),
): RevenuePayment[] {
  const days = RANGE_DAYS[range];
  if (days === null) return payments;

  const start = startOfDay(now - (days - 1) * DAY_MS);
  return payments.filter((payment) => {
    const ms = Date.parse(payment.ts);
    return !Number.isNaN(ms) && ms >= start;
  });
}

function advance(ms: number, granularity: Granularity): number {
  return ms + (granularity === 'week' ? 7 * DAY_MS : DAY_MS);
}

export interface SeriesBucket {
  /** Bucket start, midnight UTC, ISO 8601. */
  start: string;
  /** Short axis label. */
  label: string;
  /** Chain-indexed revenue carrying a merchant-reported route. */
  attributed: string;
  /** Chain-indexed revenue with no attribution. Real money, unknown route. */
  unattributed: string;
  total: string;
  calls: number;
  attributedCalls: number;
  unattributedCalls: number;
  /** Height ratios against the tallest bucket. Geometry only. */
  totalFraction: number;
  attributedFraction: number;
}

export interface RevenueSeries {
  asset: string;
  range: RangeKey;
  granularity: Granularity;
  buckets: SeriesBucket[];
  /** Tallest bucket total, as a decimal string. Drives the y-axis label. */
  max: string;
  total: string;
  attributedTotal: string;
  unattributedTotal: string;
  calls: number;
  attributedCalls: number;
  unattributedCalls: number;
  /** Payments in range whose amount could not be read, so were not summed. */
  unpricedCalls: number;
}

/** Above this many days, per-day bars stop being readable, so group by week. */
const WEEKLY_ABOVE_DAYS = 45;

function formatLabel(startMs: number, granularity: Granularity): string {
  const date = new Date(startMs);
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = date.getUTCDate();
  return granularity === 'week' ? `w/c ${month} ${day}` : `${month} ${day}`;
}

/**
 * One day's revenue in a single asset, already summed.
 *
 * This is the shape a server-side `date_trunc('day', ts)` / `GROUP BY`
 * produces (see `/api/analytics/revenue`), so the browser can render trends
 * without pulling every raw payment row. Amounts are exact decimal strings;
 * `attributed` is the part of `total` that carried a merchant-reported route.
 */
export interface RevenueDayBucket {
  /** `date_trunc('day', ts)` — midnight UTC, ISO 8601. */
  day: string;
  /** Decimal string. Revenue that day carrying a route. */
  attributed: string;
  /** Decimal string. Revenue that day with no attribution. */
  unattributed: string;
  attributedCalls: number;
  unattributedCalls: number;
  /** Payments that day whose amount could not be read (counted, not summed). */
  unpricedCalls: number;
}

/**
 * Buckets revenue over time from raw payments, splitting each bucket into
 * attributed and unattributed.
 *
 * Kept for callers that already hold the payment rows (and for tests). It
 * folds the rows into per-day totals and hands off to
 * {@link seriesFromDayBuckets}, which owns the range window, the daily→weekly
 * rollup, and the chart geometry.
 */
export function buildRevenueSeries(
  payments: RevenuePayment[],
  options: { asset: string; range: RangeKey; now?: number },
): RevenueSeries {
  const inAsset = filterByAsset(payments, options.asset).filter(
    (p) => !Number.isNaN(Date.parse(p.ts)),
  );

  interface DayCell {
    attributed: bigint;
    unattributed: bigint;
    attributedCalls: number;
    unattributedCalls: number;
    unpricedCalls: number;
  }
  const days = new Map<number, DayCell>();
  for (const payment of inAsset) {
    const dayMs = startOfDay(Date.parse(payment.ts));
    let cell = days.get(dayMs);
    if (!cell) {
      cell = {
        attributed: 0n,
        unattributed: 0n,
        attributedCalls: 0,
        unattributedCalls: 0,
        unpricedCalls: 0,
      };
      days.set(dayMs, cell);
    }
    const stroops = priceOf(payment.amount);
    if (stroops === null) cell.unpricedCalls += 1;
    const attributed = typeof payment.route === 'string' && payment.route !== '';
    if (attributed) {
      cell.attributedCalls += 1;
      if (stroops !== null) cell.attributed += stroops;
    } else {
      cell.unattributedCalls += 1;
      if (stroops !== null) cell.unattributed += stroops;
    }
  }

  const dayBuckets: RevenueDayBucket[] = [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, cell]) => ({
      day: new Date(ms).toISOString(),
      attributed: fromStroops(cell.attributed),
      unattributed: fromStroops(cell.unattributed),
      attributedCalls: cell.attributedCalls,
      unattributedCalls: cell.unattributedCalls,
      unpricedCalls: cell.unpricedCalls,
    }));

  return seriesFromDayBuckets(dayBuckets, options);
}

/**
 * Builds the chart-ready series from pre-aggregated daily buckets.
 *
 * Empty buckets are emitted rather than skipped: a day with no revenue is a
 * fact about the business, and dropping it would compress the x-axis into a
 * shape that implies steadier income than there was.
 *
 * `dayBuckets` need not be dense or in range — days outside the window are
 * ignored, and gaps are filled. Once the span passes {@link WEEKLY_ABOVE_DAYS}
 * days the daily buckets are rolled up into weeks so the axis stays readable.
 */
export function seriesFromDayBuckets(
  dayBuckets: RevenueDayBucket[],
  options: { asset: string; range: RangeKey; now?: number },
): RevenueSeries {
  const { asset, range } = options;
  const now = options.now ?? Date.now();

  const parsed = dayBuckets
    .map((b) => ({ ms: Date.parse(b.day), bucket: b }))
    .filter((d) => !Number.isNaN(d.ms));

  const days = RANGE_DAYS[range];

  // 'all' spans from the first bucket to now; a fixed range spans back from
  // today whether or not anything landed in it, so an empty week reads as an
  // empty week rather than as no data.
  const earliest = parsed.length ? Math.min(...parsed.map((d) => d.ms)) : now;
  const from = days === null ? earliest : now - (days - 1) * DAY_MS;
  const spanDays = Math.max(1, Math.ceil((now - from) / DAY_MS) + 1);
  const granularity: Granularity = spanDays > WEEKLY_ABOVE_DAYS ? 'week' : 'day';

  const firstBucket = bucketStart(from, granularity);
  const lastBucket = bucketStart(now, granularity);

  interface Cell {
    attributed: bigint;
    unattributed: bigint;
    attributedCalls: number;
    unattributedCalls: number;
    unpricedCalls: number;
  }
  const cells = new Map<number, Cell>();
  for (let ms = firstBucket; ms <= lastBucket; ms = advance(ms, granularity)) {
    cells.set(ms, {
      attributed: 0n,
      unattributed: 0n,
      attributedCalls: 0,
      unattributedCalls: 0,
      unpricedCalls: 0,
    });
  }

  for (const { ms, bucket } of parsed) {
    // Out of range, including anything the ledger stamped in the future.
    if (ms < firstBucket || ms > advance(lastBucket, granularity) - 1) continue;
    const cell = cells.get(bucketStart(ms, granularity));
    if (!cell) continue;
    cell.attributed += priceOf(bucket.attributed) ?? 0n;
    cell.unattributed += priceOf(bucket.unattributed) ?? 0n;
    cell.attributedCalls += bucket.attributedCalls;
    cell.unattributedCalls += bucket.unattributedCalls;
    cell.unpricedCalls += bucket.unpricedCalls;
  }

  const ordered = [...cells.entries()].sort((a, b) => a[0] - b[0]);
  let max = 0n;
  for (const [, cell] of ordered) {
    const total = cell.attributed + cell.unattributed;
    if (total > max) max = total;
  }

  let attributedTotal = 0n;
  let unattributedTotal = 0n;
  let attributedCalls = 0;
  let unattributedCalls = 0;
  let unpricedCalls = 0;

  const buckets = ordered.map(([ms, cell]): SeriesBucket => {
    const total = cell.attributed + cell.unattributed;
    attributedTotal += cell.attributed;
    unattributedTotal += cell.unattributed;
    attributedCalls += cell.attributedCalls;
    unattributedCalls += cell.unattributedCalls;
    unpricedCalls += cell.unpricedCalls;
    return {
      start: new Date(ms).toISOString(),
      label: formatLabel(ms, granularity),
      attributed: fromStroops(cell.attributed),
      unattributed: fromStroops(cell.unattributed),
      total: fromStroops(total),
      calls: cell.attributedCalls + cell.unattributedCalls,
      attributedCalls: cell.attributedCalls,
      unattributedCalls: cell.unattributedCalls,
      totalFraction: fraction(total, max),
      attributedFraction: fraction(cell.attributed, max),
    };
  });

  return {
    asset,
    range,
    granularity,
    buckets,
    max: fromStroops(max),
    total: fromStroops(attributedTotal + unattributedTotal),
    attributedTotal: fromStroops(attributedTotal),
    unattributedTotal: fromStroops(unattributedTotal),
    calls: attributedCalls + unattributedCalls,
    attributedCalls,
    unattributedCalls,
    unpricedCalls,
  };
}
