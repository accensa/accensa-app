import { describe, expect, it } from 'vitest';
import {
  buildRevenueSeries,
  buildRouteBreakdown,
  filterByRange,
  type RevenuePayment,
} from './revenue-analytics';

/**
 * The Revenue by Route page used to aggregate the newest 100 payments; it now
 * pages the full history in. This checks the aggregation stays cheap at a
 * realistic size and does not regress to super-linear. The measured numbers are
 * quoted in the PR description.
 */

const ROUTES = ['/api/quote', '/api/search', '/api/checkout', '/api/webhook', null];

function fixture(count: number): RevenuePayment[] {
  const now = Date.parse('2026-03-10T12:00:00.000Z');
  return Array.from({ length: count }, (_, i) => {
    const route = ROUTES[i % ROUTES.length];
    return {
      amount: `${(i % 50) + 1}.${String(i % 10).padStart(7, '0')}`,
      asset: i % 3 === 0 ? null : 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      ts: new Date(now - i * 3_600_000).toISOString(),
      route,
      method: route ? 'GET' : null,
    };
  });
}

/** One full render's worth of aggregation: all three ranges, both views. */
function aggregate(payments: RevenuePayment[]) {
  for (const range of ['7d', '30d', 'all'] as const) {
    const inRange = filterByRange(payments, range);
    buildRouteBreakdown(inRange, 'native');
    buildRevenueSeries(inRange, { asset: 'native', range });
  }
}

/** Best of a few runs, after a warm-up, to take JIT noise out of the number. */
function timeBestOf(runs: number, fn: () => void): number {
  fn(); // warm-up
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe('revenue analytics performance', () => {
  it('aggregates 500+ payments across all three ranges in a few milliseconds', () => {
    const payments = fixture(600);
    const elapsed = timeBestOf(5, () => aggregate(payments));

    console.log(`aggregate(600 payments) x3 ranges: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(40);
  });

  it('scales roughly linearly to 3,000 payments', () => {
    const small = timeBestOf(5, () => aggregate(fixture(600)));
    const large = timeBestOf(5, () => aggregate(fixture(3000)));

    console.log(`aggregate(3000 payments) x3 ranges: ${large.toFixed(2)}ms`);
    // 5x the data should be well under 15x the time — catches an O(n^2) regression.
    expect(large).toBeLessThan(small * 15 + 20);
  });
});
