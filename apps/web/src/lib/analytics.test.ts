import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import { getDashboardAnalytics } from './analytics';

/**
 * A fake pg client answering the four queries getDashboardAnalytics runs,
 * keyed off the SQL so each test can stub just the periods it cares about.
 */
function clientFor(rows: {
  current?: Record<string, unknown>[];
  previous?: Record<string, unknown>[];
  topProducts?: Record<string, unknown>[];
  dailyTrend?: Record<string, unknown>[];
}): Client {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('count(DISTINCT payer)')) return { rows: rows.current ?? [] };
    if (sql.includes('ts < $3')) return { rows: rows.previous ?? [] };
    if (sql.includes('GROUP BY route')) return { rows: rows.topProducts ?? [] };
    if (sql.includes('date_trunc')) return { rows: rows.dailyTrend ?? [] };
    throw new Error(`unexpected query: ${sql}`);
  });
  return { query } as unknown as Client;
}

describe('getDashboardAnalytics', () => {
  it('averages exactly beyond Number.MAX_SAFE_INTEGER, where floats cannot', async () => {
    // 2^53 + 1 in the whole part: parseFloat already rounds this to 2^53.
    const revenue = '9007199254740993.1234567';
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: revenue, total_payments: '3', unique_payers: '2' }],
      }),
      '1',
    );

    // The average is floored to the stroop, exactly: 90071992547409931234567
    // stroops / 3 = 30023997515803310411522 stroops.
    expect(analytics.averagePayment).toBe('3002399751580331.0411522');
    // The amount itself passes through untouched.
    expect(analytics.totalRevenue).toBe(revenue);
    expect(analytics.totalPayments).toBe(3);

    // The float route this replaces could not have produced that: 2^53 + 1
    // is not representable, so the parse snaps to the nearest double and
    // loses the .1234567 (and the +1) entirely.
    expect(Number('9007199254740993.1234567')).toBe(9007199254740994);
  });

  it('computes revenue change from stroops and rounds to 0.1%', async () => {
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: '10.0000000', total_payments: '4', unique_payers: '3' }],
        previous: [{ total_revenue: '5.0000000', total_payments: '2' }],
      }),
      '1',
    );
    expect(analytics.revenueChange).toBe(100);
  });

  it('rounds revenue change half away from zero at the 0.1% digit', async () => {
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: '100.1500000', total_payments: '1', unique_payers: '1' }],
        previous: [{ total_revenue: '100.0000000', total_payments: '1' }],
      }),
      '1',
    );
    // 0.15% -> 0.2%, decided in bigint before any float is involved.
    expect(analytics.revenueChange).toBe(0.2);
  });

  it('floors the average to the stroop like the route breakdown does', async () => {
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: '1.0000000', total_payments: '3', unique_payers: '1' }],
      }),
      '1',
    );
    // 10,000,000 stroops / 3 = 3,333,333r stroops, not a rounded 0.3333334.
    expect(analytics.averagePayment).toBe('0.3333333');
  });

  it('reports zero growth and no average when there is nothing to compare', async () => {
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: '0', total_payments: '0', unique_payers: '0' }],
      }),
      '1',
    );
    expect(analytics.revenueChange).toBe(0);
    expect(analytics.paymentsChange).toBe(0);
    expect(analytics.averagePayment).toBe('0');
  });

  it('passes top product revenue and daily trend amounts through verbatim', async () => {
    const analytics = await getDashboardAnalytics(
      clientFor({
        current: [{ total_revenue: '12.5000000', total_payments: '2', unique_payers: '1' }],
        topProducts: [{ route: '/api/quote', revenue: '9007199254740993.1234567', count: '1' }],
        dailyTrend: [
          { day: new Date('2026-08-20T00:00:00.000Z'), revenue: '7.2500000', count: '1' },
          { day: '2026-08-19', revenue: '5.2500000', count: '1' },
        ],
      }),
      '1',
    );
    expect(analytics.topProducts[0].revenue).toBe('9007199254740993.1234567');
    expect(analytics.dailyTrend.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-19']);
    expect(analytics.dailyTrend[0].revenue).toBe('7.2500000');
  });
});
