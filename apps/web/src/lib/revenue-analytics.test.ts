import { describe, it, expect } from 'vitest';
import {
  assetKey,
  assetOptions,
  buildRevenueSeries,
  buildRouteBreakdown,
  filterByAsset,
  filterByRange,
  fraction,
  RANGE_DAYS,
  UNATTRIBUTED_LABEL,
  type RevenuePayment,
} from './revenue-analytics';

const USDC = 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_OTHER = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function payment(over: Partial<RevenuePayment> = {}): RevenuePayment {
  return {
    amount: '1.0000000',
    asset: null,
    ts: '2026-03-10T12:00:00.000Z',
    route: '/api/quote',
    method: 'GET',
    ...over,
  };
}

describe('assetKey / assetOptions', () => {
  it('treats a null asset as native', () => {
    expect(assetKey(null)).toBe('native');
    expect(assetKey(USDC)).toBe(USDC);
  });

  it('never merges two issuers that share an asset code', () => {
    const options = assetOptions([
      payment({ asset: USDC }),
      payment({ asset: USDC }),
      payment({ asset: USDC_OTHER }),
    ]);

    expect(options).toHaveLength(2);
    expect(options.map((o) => o.key)).toEqual([USDC, USDC_OTHER]);
    // Both are"USDC", so the issuer is surfaced to keep them distinguishable.
    expect(options[0].label).toContain('USDC (');
    expect(options[1].label).toContain('USDC (');
    expect(options[0].label).not.toBe(options[1].label);
  });

  it('leaves an unambiguous label alone and orders by usage', () => {
    const options = assetOptions([payment({ asset: USDC }), payment(), payment()]);
    expect(options[0]).toMatchObject({ key: 'native', label: 'XLM', calls: 2 });
    expect(options[1]).toMatchObject({ key: USDC, label: 'USDC', calls: 1 });
  });

  it('returns nothing for no payments', () => {
    expect(assetOptions([])).toEqual([]);
  });

  it('filters by the raw identifier, not the display code', () => {
    const rows = [payment({ asset: USDC }), payment({ asset: USDC_OTHER })];
    expect(filterByAsset(rows, USDC)).toHaveLength(1);
  });
});

describe('fraction', () => {
  it('derives a ratio from bigints without overflowing a float', () => {
    // 2^70 stroops: far beyond Number.MAX_SAFE_INTEGER, so a naive
    // Number(value) / Number(max) would already have lost precision.
    const max = 1n << 70n;
    expect(fraction(max / 4n, max)).toBeCloseTo(0.25, 6);
  });

  it('clamps and guards the degenerate cases', () => {
    expect(fraction(0n, 0n)).toBe(0);
    expect(fraction(5n, 0n)).toBe(0);
    expect(fraction(-5n, 10n)).toBe(0);
    expect(fraction(20n, 10n)).toBe(1);
  });
});

describe('buildRouteBreakdown', () => {
  it('groups by method and route, highest revenue first', () => {
    const breakdown = buildRouteBreakdown(
      [
        payment({ route: '/api/quote', method: 'GET', amount: '1.0000000' }),
        payment({ route: '/api/quote', method: 'GET', amount: '2.5000000' }),
        payment({ route: '/api/quote', method: 'POST', amount: '10.0000000' }),
        payment({ route: '/api/search', method: 'GET', amount: '0.0000003' }),
      ],
      'native',
    );

    expect(breakdown.routes.map((r) => `${r.method} ${r.route}`)).toEqual([
      'POST /api/quote',
      'GET /api/quote',
      'GET /api/search',
    ]);
    expect(breakdown.routes[1].total).toBe('3.5000000');
    expect(breakdown.routes[1].calls).toBe(2);
    expect(breakdown.routes[1].average).toBe('1.7500000');
    expect(breakdown.total).toBe('13.5000003');
    expect(breakdown.unattributed).toBeNull();
  });

  it('sums exactly where a float would drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    expect(
      buildRouteBreakdown(
        [payment({ amount: '0.1000000' }), payment({ amount: '0.2000000' })],
        'native',
      ).total,
    ).toBe('0.3000000');

    // And at the top of the safe-integer range, where stroops exceed 2^53.
    const big = Array.from({ length: 3 }, () => payment({ amount: '9007199.2540741' }));
    const breakdown = buildRouteBreakdown(big, 'native');
    expect(breakdown.total).toBe('27021597.7622223');
    expect(breakdown.routes[0].average).toBe('9007199.2540741');
  });

  it('keeps unattributed payments in their own bucket, counted but not merged', () => {
    const breakdown = buildRouteBreakdown(
      [
        payment({ route: '/api/quote', amount: '4.0000000' }),
        payment({ route: null, method: null, amount: '6.0000000' }),
        payment({ route: null, method: null, amount: '2.0000000' }),
      ],
      'native',
    );

    expect(breakdown.routes).toHaveLength(1);
    expect(breakdown.routes[0].total).toBe('4.0000000');

    const unattributed = breakdown.unattributed;
    expect(unattributed).not.toBeNull();
    expect(unattributed?.key).toBe(UNATTRIBUTED_LABEL);
    expect(unattributed?.attributed).toBe(false);
    expect(unattributed?.route).toBeNull();
    expect(unattributed?.calls).toBe(2);
    expect(unattributed?.total).toBe('8.0000000');
    expect(unattributed?.average).toBe('4.0000000');

    // The overall total is every payment; attribution splits it, never trims it.
    expect(breakdown.total).toBe('12.0000000');
    expect(breakdown.attributedTotal).toBe('4.0000000');
    expect(breakdown.unattributedTotal).toBe('8.0000000');
    expect(breakdown.calls).toBe(3);
    expect(breakdown.attributedCalls).toBe(1);
    expect(breakdown.unattributedCalls).toBe(2);
    expect(unattributed?.share).toBeCloseTo(2 / 3, 3);
  });

  it('treats an empty route string as unattributed rather than as a route', () => {
    const breakdown = buildRouteBreakdown([payment({ route: '', method: 'GET' })], 'native');
    expect(breakdown.routes).toEqual([]);
    expect(breakdown.unattributed?.calls).toBe(1);
  });

  it('does not mix assets', () => {
    const rows = [
      payment({ asset: null, amount: '5.0000000' }),
      payment({ asset: USDC, amount: '100.0000000' }),
    ];
    expect(buildRouteBreakdown(rows, 'native').total).toBe('5.0000000');
    expect(buildRouteBreakdown(rows, USDC).total).toBe('100.0000000');
  });

  it('counts a payment with an unreadable amount without inventing a value', () => {
    const breakdown = buildRouteBreakdown(
      [
        payment({ amount: '3.0000000' }),
        payment({ amount: null }),
        payment({ amount: 'not-a-number' }),
      ],
      'native',
    );

    expect(breakdown.calls).toBe(3);
    expect(breakdown.unpricedCalls).toBe(2);
    expect(breakdown.total).toBe('3.0000000');
    expect(breakdown.routes[0].priced).toBe(1);
    expect(breakdown.routes[0].unpriced).toBe(2);
    // Averaged over what was actually priced, not over all three.
    expect(breakdown.routes[0].average).toBe('3.0000000');
  });

  it('reports no average when nothing in the bucket could be priced', () => {
    const breakdown = buildRouteBreakdown([payment({ amount: null })], 'native');
    expect(breakdown.routes[0].average).toBeNull();
    expect(breakdown.routes[0].total).toBe('0.0000000');
  });

  it('handles empty data', () => {
    const breakdown = buildRouteBreakdown([], 'native');
    expect(breakdown).toMatchObject({
      routes: [],
      unattributed: null,
      total: '0.0000000',
      attributedTotal: '0.0000000',
      unattributedTotal: '0.0000000',
      calls: 0,
      attributedCalls: 0,
      unattributedCalls: 0,
      unpricedCalls: 0,
    });
  });
});

describe('buildRevenueSeries', () => {
  const now = Date.parse('2026-03-10T12:00:00.000Z');

  it('emits one bucket per day across the whole range, including empty days', () => {
    const series = buildRevenueSeries([payment({ ts: '2026-03-10T01:00:00.000Z' })], {
      asset: 'native',
      range: '7d',
      now,
    });

    expect(series.granularity).toBe('day');
    expect(series.buckets).toHaveLength(7);
    expect(series.buckets[0].start).toBe('2026-03-04T00:00:00.000Z');
    expect(series.buckets[6].start).toBe('2026-03-10T00:00:00.000Z');
    // Quiet days are shown as zero, not compressed out of the axis.
    expect(series.buckets[0].total).toBe('0.0000000');
    expect(series.buckets[0].totalFraction).toBe(0);
    expect(series.buckets[6].total).toBe('1.0000000');
    expect(series.buckets[6].totalFraction).toBe(1);
  });

  it('splits each bucket into attributed and unattributed without dropping either', () => {
    const series = buildRevenueSeries(
      [
        payment({ ts: '2026-03-09T09:00:00.000Z', route: '/api/quote', amount: '3.0000000' }),
        payment({ ts: '2026-03-09T10:00:00.000Z', route: null, method: null, amount: '1.0000000' }),
      ],
      { asset: 'native', range: '7d', now },
    );

    const day = series.buckets.find((b) => b.start === '2026-03-09T00:00:00.000Z');
    expect(day?.attributed).toBe('3.0000000');
    expect(day?.unattributed).toBe('1.0000000');
    expect(day?.total).toBe('4.0000000');
    expect(day?.attributedCalls).toBe(1);
    expect(day?.unattributedCalls).toBe(1);
    // The stack is drawn attributed-first, so the geometry must agree that the
    // unattributed segment is the remaining quarter.
    expect(day?.attributedFraction).toBeCloseTo(0.75, 4);
    expect(day?.totalFraction).toBe(1);

    expect(series.attributedTotal).toBe('3.0000000');
    expect(series.unattributedTotal).toBe('1.0000000');
    expect(series.total).toBe('4.0000000');
    expect(series.max).toBe('4.0000000');
  });

  it('excludes payments older than the range', () => {
    const series = buildRevenueSeries(
      [
        payment({ ts: '2026-01-01T00:00:00.000Z', amount: '99.0000000' }),
        payment({ ts: '2026-03-08T00:00:00.000Z', amount: '2.0000000' }),
      ],
      { asset: 'native', range: '7d', now },
    );
    expect(series.total).toBe('2.0000000');
    expect(series.calls).toBe(1);
  });

  it('switches to weekly buckets once a daily axis stops being readable', () => {
    const series = buildRevenueSeries(
      [payment({ ts: '2025-12-01T00:00:00.000Z' }), payment({ ts: '2026-03-09T00:00:00.000Z' })],
      { asset: 'native', range: 'all', now },
    );

    expect(series.granularity).toBe('week');
    // Weeks start on Monday UTC; 2025-12-01 was a Monday.
    expect(series.buckets[0].start).toBe('2025-12-01T00:00:00.000Z');
    expect(series.buckets[0].label).toBe('w/c Dec 1');
    expect(series.calls).toBe(2);
    expect(series.total).toBe('2.0000000');
  });

  it('spans from the first payment when the range is all time', () => {
    const series = buildRevenueSeries([payment({ ts: '2026-03-08T00:00:00.000Z' })], {
      asset: 'native',
      range: 'all',
      now,
    });
    expect(series.granularity).toBe('day');
    expect(series.buckets[0].start).toBe('2026-03-08T00:00:00.000Z');
    expect(series.buckets.at(-1)?.start).toBe('2026-03-10T00:00:00.000Z');
  });

  it('does not mix assets', () => {
    const rows = [
      payment({ asset: null, amount: '5.0000000' }),
      payment({ asset: USDC, amount: '100.0000000' }),
    ];
    expect(buildRevenueSeries(rows, { asset: USDC, range: '7d', now }).total).toBe('100.0000000');
  });

  it('counts an unreadable amount without summing it', () => {
    const series = buildRevenueSeries([payment({ amount: 'oops' })], {
      asset: 'native',
      range: '7d',
      now,
    });
    expect(series.unpricedCalls).toBe(1);
    expect(series.calls).toBe(1);
    expect(series.total).toBe('0.0000000');
  });

  it('ignores an unparseable timestamp rather than bucketing it at the epoch', () => {
    const series = buildRevenueSeries([payment({ ts: 'never' })], {
      asset: 'native',
      range: 'all',
      now,
    });
    expect(series.calls).toBe(0);
  });

  it('handles empty data without producing a degenerate axis', () => {
    for (const range of Object.keys(RANGE_DAYS) as Array<keyof typeof RANGE_DAYS>) {
      const series = buildRevenueSeries([], { asset: 'native', range, now });
      expect(series.buckets.length).toBeGreaterThan(0);
      expect(series.max).toBe('0.0000000');
      expect(series.total).toBe('0.0000000');
      expect(series.calls).toBe(0);
      expect(series.buckets.every((b) => b.totalFraction === 0)).toBe(true);
    }
  });
});

describe('filterByRange', () => {
  const now = Date.parse('2026-03-10T12:00:00.000Z');

  it('returns everything for the all-time range', () => {
    const rows = [
      payment({ ts: '2020-01-01T00:00:00.000Z' }),
      payment({ ts: '2026-03-10T00:00:00.000Z' }),
    ];
    expect(filterByRange(rows, 'all', now)).toBe(rows);
  });

  it('keeps only the last 7 days, aligned to midnight UTC', () => {
    // now is 2026-03-10T12:00Z, so the 7-day window starts at 2026-03-04T00:00Z
    // (midnight of the sixth day back) — the same boundary buildRevenueSeries uses.
    const rows = [
      payment({ ts: '2026-03-03T23:00:00.000Z', route: '/old' }), // before the window start
      payment({ ts: '2026-03-04T00:00:00.000Z', route: '/edge' }), // exactly the window start
      payment({ ts: '2026-03-09T18:00:00.000Z', route: '/recent' }),
    ];
    const kept = filterByRange(rows, '7d', now).map((p) => p.route);
    expect(kept).toEqual(['/edge', '/recent']);
  });

  it('scopes a route breakdown to the selected range', () => {
    const rows = [
      payment({ ts: '2026-01-01T00:00:00.000Z', amount: '100.0000000', route: '/a' }),
      payment({ ts: '2026-03-09T00:00:00.000Z', amount: '25.0000000', route: '/a' }),
      payment({ ts: '2026-03-09T00:00:00.000Z', amount: '75.0000000', route: '/b' }),
    ];

    const allTime = buildRouteBreakdown(filterByRange(rows, 'all', now), 'native');
    expect(allTime.total).toBe('200.0000000');

    const last30 = buildRouteBreakdown(filterByRange(rows, '30d', now), 'native');
    expect(last30.total).toBe('100.0000000');
    // Shares are computed against the in-range total, not the all-time total.
    const routeA = last30.routes.find((r) => r.route === '/a');
    expect(routeA?.share).toBeCloseTo(0.25, 5);
  });

  it('drops rows with an unparseable timestamp from a bounded range', () => {
    expect(filterByRange([payment({ ts: 'nonsense' })], '30d', now)).toHaveLength(0);
  });
});
