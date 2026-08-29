import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import {
  assetOptionsFromCounts,
  type AssetOption,
  type RevenueDayBucket,
  type RouteAggregate,
} from '@/lib/revenue-analytics';

export const dynamic = 'force-dynamic';

/**
 * Server-side revenue aggregation for the "Revenue by Route" view.
 *
 * The browser used to pull the raw payment rows and fold them itself. A
 * merchant processing thousands of sub-cent x402 requests a day would send
 * that whole table over the wire and aggregate it in a render pass. This
 * route does the summation in PostgreSQL instead — one `GROUP BY
 * date_trunc('day', ts), asset` for the time series and one `GROUP BY
 * method, route, asset` for the route breakdown — and returns only the
 * aggregates, per asset.
 *
 * Amounts stay exact: `NUMERIC` in, decimal `::text` out, never a float.
 * `ts IS NOT NULL` keeps merchant-reported attributions that the indexer
 * has not yet confirmed out of the figures (see `db.ts`). No time filter is
 * applied here — the output is one row per (day, asset) and per (route,
 * asset), bounded regardless of table size — so the client can switch
 * range with no refetch.
 */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { dayRows, routeRows, assetCounts } = await withMerchantClient(
      merchant.id,
      async (client) => {
        await ensureSchema(client);

        const days = await client.query(
          `SELECT
           to_char(date_trunc('day', ts) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS day,
           COALESCE(asset, 'native') AS asset_key,
           COALESCE(sum(amount) FILTER (WHERE route IS NOT NULL AND route <> ''), 0)::text AS attributed,
           COALESCE(sum(amount) FILTER (WHERE route IS NULL OR route = ''), 0)::text AS unattributed,
           count(*) FILTER (WHERE route IS NOT NULL AND route <> '') AS attributed_calls,
           count(*) FILTER (WHERE route IS NULL OR route = '') AS unattributed_calls,
           count(*) FILTER (WHERE amount IS NULL) AS unpriced_calls
         FROM payments
         WHERE merchant_id = $1 AND ts IS NOT NULL
         GROUP BY date_trunc('day', ts), COALESCE(asset, 'native')
         ORDER BY day ASC`,
          [merchant.id],
        );

        const routes = await client.query(
          `SELECT
           COALESCE(asset, 'native') AS asset_key,
           method,
           route,
           COALESCE(sum(amount), 0)::text AS total,
           count(*) AS calls,
           count(amount) AS priced
         FROM payments
         WHERE merchant_id = $1 AND ts IS NOT NULL
         GROUP BY COALESCE(asset, 'native'), method, route`,
          [merchant.id],
        );

        const assets = await client.query(
          `SELECT COALESCE(asset, 'native') AS asset_key, count(*) AS calls
         FROM payments
         WHERE merchant_id = $1 AND ts IS NOT NULL
         GROUP BY COALESCE(asset, 'native')`,
          [merchant.id],
        );

        return { dayRows: days.rows, routeRows: routes.rows, assetCounts: assets.rows };
      },
    );

    const assets: AssetOption[] = assetOptionsFromCounts(
      assetCounts.map((r) => ({ key: String(r.asset_key), calls: Number(r.calls) })),
    );

    const days: Record<string, RevenueDayBucket[]> = {};
    for (const r of dayRows) {
      const key = String(r.asset_key);
      (days[key] ??= []).push({
        day: String(r.day),
        attributed: String(r.attributed),
        unattributed: String(r.unattributed),
        attributedCalls: Number(r.attributed_calls),
        unattributedCalls: Number(r.unattributed_calls),
        unpricedCalls: Number(r.unpriced_calls),
      });
    }

    const routes: Record<string, RouteAggregate[]> = {};
    for (const r of routeRows) {
      const key = String(r.asset_key);
      (routes[key] ??= []).push({
        method: r.method === null ? null : String(r.method),
        route: r.route === null ? null : String(r.route),
        total: String(r.total),
        calls: Number(r.calls),
        priced: Number(r.priced),
      });
    }

    return NextResponse.json({ assets, days, routes });
  } catch (error: unknown) {
    console.error('Error aggregating revenue analytics:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
