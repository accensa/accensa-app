import { describe, expect, it } from 'vitest';
import {
  aggregateFunnel,
  compareRanges,
  monthRanges,
  percent,
  segmentFunnel,
  type CheckoutEvent,
  type FunnelStepKey,
} from './funnel';

const ORDER: FunnelStepKey[] = [
  'checkout_opened',
  'wallet_connected',
  'authorization_approved',
  'payment_settled',
];

/** A session that reached `depth` steps (1 to 4). */
function session(
  id: string,
  depth: number,
  opts: { ts?: number; device?: 'mobile' | 'desktop'; wallet?: string } = {},
): CheckoutEvent[] {
  return ORDER.slice(0, depth).map((step) => ({
    sessionId: id,
    step,
    ts: opts.ts ?? 1_000,
    device: opts.device ?? 'desktop',
    wallet: opts.wallet ?? 'freighter',
  }));
}

describe('percent', () => {
  it('is zero-division safe', () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 4)).toBe(25);
  });
});

describe('aggregateFunnel', () => {
  it('returns an all-zero funnel for no events without NaN', () => {
    const r = aggregateFunnel([]);
    expect(r.steps.map((s) => s.count)).toEqual([0, 0, 0, 0]);
    for (const s of r.steps) {
      expect(Number.isFinite(s.conversionFromPrevious)).toBe(true);
      expect(Number.isFinite(s.conversionFromStart)).toBe(true);
      expect(s.dropOff).toBe(0);
    }
    expect(r.bottleneck).toBeNull();
    expect(r.overallConversion).toBe(0);
  });

  it('computes step and overall conversion', () => {
    // 10 open, 8 connect, 4 authorize, 2 settle
    const events = [
      ...Array.from({ length: 2 }, (_, i) => session(`a${i}`, 4)).flat(),
      ...Array.from({ length: 2 }, (_, i) => session(`b${i}`, 3)).flat(),
      ...Array.from({ length: 4 }, (_, i) => session(`c${i}`, 2)).flat(),
      ...Array.from({ length: 2 }, (_, i) => session(`d${i}`, 1)).flat(),
    ];
    const r = aggregateFunnel(events);
    expect(r.steps.map((s) => s.count)).toEqual([10, 8, 4, 2]);
    expect(r.steps.map((s) => s.conversionFromPrevious)).toEqual([100, 80, 50, 50]);
    expect(r.steps.map((s) => s.conversionFromStart)).toEqual([100, 80, 40, 20]);
    expect(r.overallConversion).toBe(20);
  });

  it('identifies the largest drop-off as the bottleneck (first wins ties)', () => {
    const events = [
      ...Array.from({ length: 2 }, (_, i) => session(`a${i}`, 4)).flat(),
      ...Array.from({ length: 2 }, (_, i) => session(`b${i}`, 3)).flat(),
      ...Array.from({ length: 4 }, (_, i) => session(`c${i}`, 2)).flat(),
      ...Array.from({ length: 2 }, (_, i) => session(`d${i}`, 1)).flat(),
    ];
    const r = aggregateFunnel(events);
    expect(r.bottleneck?.key).toBe('authorization_approved'); // 50% lost, ties with settled
  });

  it('counts a session once per step even with duplicate events', () => {
    const events = [...session('s', 2), ...session('s', 2)];
    expect(aggregateFunnel(events).steps.map((s) => s.count)).toEqual([1, 1, 0, 0]);
  });

  it('treats a later step as implying the earlier ones (lost upstream event)', () => {
    const events: CheckoutEvent[] = [
      { sessionId: 's', step: 'payment_settled', ts: 1, device: 'mobile', wallet: 'x' },
    ];
    expect(aggregateFunnel(events).steps.map((s) => s.count)).toEqual([1, 1, 1, 1]);
  });

  it('ignores events with an unknown step', () => {
    const events = [
      { sessionId: 's', step: 'teleported', ts: 1, device: 'mobile', wallet: 'x' },
    ] as unknown as CheckoutEvent[];
    expect(aggregateFunnel(events).steps[0].count).toBe(0);
  });

  it('has no bottleneck when nothing drops', () => {
    expect(aggregateFunnel(session('s', 4)).bottleneck).toBeNull();
  });

  it('applies the date range as [from, to)', () => {
    const events = [...session('in', 1, { ts: 100 }), ...session('edge', 1, { ts: 200 })];
    expect(aggregateFunnel(events, { range: { from: 100, to: 200 } }).steps[0].count).toBe(1);
  });
});

describe('segmentFunnel', () => {
  const events = [
    ...session('m1', 4, { device: 'mobile', wallet: 'lobstr' }),
    ...session('m2', 1, { device: 'mobile', wallet: 'lobstr' }),
    ...session('m3', 1, { device: 'mobile', wallet: 'freighter' }),
    ...session('d1', 4, { device: 'desktop', wallet: 'freighter' }),
  ];

  it('splits by device, largest audience first', () => {
    const segs = segmentFunnel(events, 'device');
    expect(segs.map((s) => s.label)).toEqual(['mobile', 'desktop']);
    expect(segs[0].funnel.overallConversion).toBeCloseTo(100 / 3);
    expect(segs[1].funnel.overallConversion).toBe(100);
  });

  it('splits by wallet provider', () => {
    const segs = segmentFunnel(events, 'wallet');
    expect(segs.map((s) => [s.label, s.funnel.steps[0].count])).toEqual([
      ['freighter', 2],
      ['lobstr', 2],
    ]);
  });

  it('segment counts sum to the unsegmented total', () => {
    const total = aggregateFunnel(events).steps[0].count;
    const sum = segmentFunnel(events, 'device').reduce((n, s) => n + s.funnel.steps[0].count, 0);
    expect(sum).toBe(total);
  });
});

describe('compareRanges', () => {
  it('reports per-step point deltas, current minus prior', () => {
    const cur = { from: 1_000, to: 2_000 };
    const pri = { from: 0, to: 1_000 };
    const events = [
      ...session('p1', 2, { ts: 10 }),
      ...session('p2', 1, { ts: 20 }), // prior: 50% wallet connect
      ...session('c1', 2, { ts: 1_010 }),
      ...session('c2', 2, { ts: 1_020 }), // current: 100% wallet connect
    ];
    const r = compareRanges(events, cur, pri);
    expect(r.deltaPoints).toEqual([0, 50, 0, 0]);
  });

  it('handles an empty prior period', () => {
    const r = compareRanges(
      session('c', 4, { ts: 1_500 }),
      { from: 1_000, to: 2_000 },
      { from: 0, to: 1_000 },
    );
    expect(r.prior.overallConversion).toBe(0);
    expect(r.deltaPoints.every(Number.isFinite)).toBe(true);
  });
});

describe('monthRanges', () => {
  it('returns adjacent UTC calendar months, including across a year boundary', () => {
    const { current, prior } = monthRanges(Date.UTC(2026, 0, 15));
    expect(current).toEqual({ from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1) });
    expect(prior).toEqual({ from: Date.UTC(2025, 11, 1), to: Date.UTC(2026, 0, 1) });
  });
});
