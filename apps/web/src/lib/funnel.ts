/**
 * Checkout conversion funnel aggregation (#449).
 *
 * Input is raw checkout telemetry: one event per (session, step reached).
 * A session counts at a step when it reached that step *or any later one*, so
 * counts are monotonically non-increasing even if an upstream event was lost.
 */

export const FUNNEL_STEPS = [
  { key: 'checkout_opened', label: 'Checkout Opened' },
  { key: 'wallet_connected', label: 'Wallet Connected' },
  { key: 'authorization_approved', label: 'Authorization Approved' },
  { key: 'payment_settled', label: 'Payment Settled' },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]['key'];
export type DeviceType = 'mobile' | 'desktop';

export interface CheckoutEvent {
  sessionId: string;
  step: FunnelStepKey;
  /** Epoch milliseconds. */
  ts: number;
  device: DeviceType;
  wallet: string;
}

export interface DateRange {
  /** Inclusive, epoch ms. */
  from: number;
  /** Exclusive, epoch ms. */
  to: number;
}

export interface FunnelFilters {
  range?: DateRange;
  device?: DeviceType;
  wallet?: string;
}

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  count: number;
  /** Share of the previous step that reached this one, 0 to 100. First step is 100 when non-empty. */
  conversionFromPrevious: number;
  /** Share of the first step that reached this one, 0 to 100. */
  conversionFromStart: number;
  /** Share lost between the previous step and this one, 0 to 100. */
  dropOff: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  /** The step after which the largest share of sessions was lost; null when nothing was lost. */
  bottleneck: FunnelStep | null;
  /** Overall start-to-settled conversion, 0 to 100. */
  overallConversion: number;
}

/** `part / whole` as a percentage, 0 when `whole` is 0 (no NaN or Infinity). */
export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

const STEP_INDEX = new Map<FunnelStepKey, number>(FUNNEL_STEPS.map((s, i) => [s.key, i]));

export function filterEvents(
  events: CheckoutEvent[],
  filters: FunnelFilters = {},
): CheckoutEvent[] {
  const { range, device, wallet } = filters;
  return events.filter(
    (e) =>
      (!range || (e.ts >= range.from && e.ts < range.to)) &&
      (!device || e.device === device) &&
      (!wallet || e.wallet === wallet),
  );
}

export function aggregateFunnel(
  events: CheckoutEvent[],
  filters: FunnelFilters = {},
): FunnelResult {
  // Furthest step index each session reached.
  const furthest = new Map<string, number>();
  for (const e of filterEvents(events, filters)) {
    const idx = STEP_INDEX.get(e.step);
    if (idx === undefined) continue; // unknown step from a newer client: ignore, don't crash
    furthest.set(e.sessionId, Math.max(furthest.get(e.sessionId) ?? -1, idx));
  }

  const reached = FUNNEL_STEPS.map(() => 0);
  for (const idx of furthest.values()) {
    for (let i = 0; i <= idx; i++) reached[i]++;
  }

  const start = reached[0];
  const steps: FunnelStep[] = FUNNEL_STEPS.map((step, i) => {
    const previous = i === 0 ? reached[0] : reached[i - 1];
    const conversionFromPrevious = percent(reached[i], previous);
    return {
      ...step,
      count: reached[i],
      conversionFromPrevious,
      conversionFromStart: percent(reached[i], start),
      dropOff: previous > 0 ? 100 - conversionFromPrevious : 0,
    };
  });

  let bottleneck: FunnelStep | null = null;
  for (const step of steps.slice(1)) {
    if (step.dropOff > 0 && (!bottleneck || step.dropOff > bottleneck.dropOff)) bottleneck = step;
  }

  return {
    steps,
    bottleneck,
    overallConversion: steps[steps.length - 1].conversionFromStart,
  };
}

export interface Segment {
  label: string;
  funnel: FunnelResult;
}

/** One funnel per distinct device or wallet value, largest audience first. */
export function segmentFunnel(
  events: CheckoutEvent[],
  by: 'device' | 'wallet',
  filters: FunnelFilters = {},
): Segment[] {
  const values = [...new Set(filterEvents(events, filters).map((e) => e[by]))];
  return values
    .map((label) => ({
      label,
      funnel: aggregateFunnel(events, { ...filters, [by]: label }),
    }))
    .sort(
      (a, b) => b.funnel.steps[0].count - a.funnel.steps[0].count || a.label.localeCompare(b.label),
    );
}

export interface RangeComparison {
  current: FunnelResult;
  prior: FunnelResult;
  /** Per-step change in `conversionFromStart`, in percentage points (current minus prior). */
  deltaPoints: number[];
}

export function compareRanges(
  events: CheckoutEvent[],
  current: DateRange,
  prior: DateRange,
  filters: Omit<FunnelFilters, 'range'> = {},
): RangeComparison {
  const cur = aggregateFunnel(events, { ...filters, range: current });
  const pri = aggregateFunnel(events, { ...filters, range: prior });
  return {
    current: cur,
    prior: pri,
    deltaPoints: cur.steps.map((s, i) => s.conversionFromStart - pri.steps[i].conversionFromStart),
  };
}

/** Calendar-month ranges (UTC) for the month containing `now` and the one before it. */
export function monthRanges(now: number): { current: DateRange; prior: DateRange } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    current: { from: Date.UTC(y, m, 1), to: Date.UTC(y, m + 1, 1) },
    prior: { from: Date.UTC(y, m - 1, 1), to: Date.UTC(y, m, 1) },
  };
}
