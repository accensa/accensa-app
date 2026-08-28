/**
 * Dashboard Analytics Overview (#152).
 *
 * Provides aggregate analytics for the merchant dashboard: revenue trends,
 * payment counts, top products, and conversion metrics.
 *
 * Usage:
 *   import { getDashboardAnalytics } from '@/lib/analytics';
 *
 *   const analytics = await getDashboardAnalytics(client, merchantId, {
 *     period: '30d',
 *   });
 */

import type { Client } from 'pg';

export type AnalyticsPeriod = '24h' | '7d' | '30d' | '90d' | 'all';

export interface DashboardAnalytics {
  /** Total revenue in the period (decimal string). */
  totalRevenue: string;
  /** Total number of payments in the period. */
  totalPayments: number;
  /** Average payment amount (decimal string). */
  averagePayment: string;
  /** Revenue compared to previous same-length period (%). */
  revenueChange: number;
  /** Payment count compared to previous period (%). */
  paymentsChange: number;
  /** Top products by revenue. */
  topProducts: Array<{
    route: string;
    revenue: string;
    count: number;
  }>;
  /** Daily revenue trend for charting. */
  dailyTrend: Array<{
    date: string;
    revenue: string;
    count: number;
  }>;
  /** Unique payers in the period. */
  uniquePayers: number;
}

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 36500, // ~100 years
};

/**
 * Get dashboard analytics for a merchant.
 */
export async function getDashboardAnalytics(
  client: Client,
  merchantId: string,
  opts: { period?: AnalyticsPeriod } = {},
): Promise<DashboardAnalytics> {
  const period = opts.period ?? '30d';
  const days = PERIOD_DAYS[period];
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const previousSince = new Date(Date.now() - days * 2 * 86400000).toISOString();

  // Current period stats
  const currentStats = await client.query<{
    total_revenue: string;
    total_payments: string;
    unique_payers: string;
  }>(
    `SELECT
       coalesce(sum(amount), 0)::text AS total_revenue,
       count(*)::text AS total_payments,
       count(DISTINCT payer)::text AS unique_payers
     FROM payments
     WHERE merchant_id = $1 AND ts >= $2`,
    [merchantId, since],
  );

  // Previous period stats (for comparison)
  const previousStats = await client.query<{
    total_revenue: string;
    total_payments: string;
  }>(
    `SELECT
       coalesce(sum(amount), 0)::text AS total_revenue,
       count(*)::text AS total_payments
     FROM payments
     WHERE merchant_id = $1 AND ts >= $2 AND ts < $3`,
    [merchantId, previousSince, since],
  );

  const cur = currentStats.rows[0];
  const prev = previousStats.rows[0];

  const totalRevenue = cur?.total_revenue ?? '0';
  const totalPayments = parseInt(cur?.total_payments ?? '0', 10);
  const uniquePayers = parseInt(cur?.unique_payers ?? '0', 10);
  const prevRevenue = parseFloat(prev?.total_revenue ?? '0');
  const prevPayments = parseInt(prev?.total_payments ?? '0', 10);

  const revenueChange =
    prevRevenue > 0 ? ((parseFloat(totalRevenue) - prevRevenue) / prevRevenue) * 100 : 0;
  const paymentsChange =
    prevPayments > 0 ? ((totalPayments - prevPayments) / prevPayments) * 100 : 0;

  // Top products
  const topProductsResult = await client.query<{
    route: string;
    revenue: string;
    count: string;
  }>(
    `SELECT route, coalesce(sum(amount), 0)::text AS revenue, count(*)::text AS count
     FROM payments
     WHERE merchant_id = $1 AND ts >= $2 AND route IS NOT NULL
     GROUP BY route
     ORDER BY sum(amount) DESC
     LIMIT 5`,
    [merchantId, since],
  );

  // Daily trend
  const dailyTrendResult = await client.query<{
    day: string;
    revenue: string;
    count: string;
  }>(
    `SELECT date_trunc('day', ts)::date AS day,
            coalesce(sum(amount), 0)::text AS revenue,
            count(*)::text AS count
     FROM payments
     WHERE merchant_id = $1 AND ts >= $2
     GROUP BY day
     ORDER BY day`,
    [merchantId, since],
  );

  return {
    totalRevenue,
    totalPayments,
    averagePayment: totalPayments > 0 ? (parseFloat(totalRevenue) / totalPayments).toFixed(7) : '0',
    revenueChange: Math.round(revenueChange * 10) / 10,
    paymentsChange: Math.round(paymentsChange * 10) / 10,
    topProducts: topProductsResult.rows.map(
      (r: { route: string; revenue: string; count: string }) => ({
        route: r.route,
        revenue: r.revenue,
        count: parseInt(r.count, 10),
      }),
    ),
    dailyTrend: dailyTrendResult.rows.map(
      (r: { day: string | Date; revenue: string; count: string }) => ({
        date: r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day),
        revenue: r.revenue,
        count: parseInt(r.count, 10),
      }),
    ),
    uniquePayers,
  };
}
