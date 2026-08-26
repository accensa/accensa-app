import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limitParam = searchParams.get('limit');

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number.parseFloat(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `limit must be an integer between 1 and ${MAX_LIMIT}` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      let query = `
 SELECT COALESCE(route, '(unattributed)') as route, method, SUM(amount) as total_revenue, COUNT(*) as calls
 FROM payments
 WHERE merchant_id = $1 AND ts IS NOT NULL
 `;
      const params: (string | number)[] = [merchant.id];

      // Apply a default time window when no explicit from/to is given so
      // the aggregate does not scan the entire table on every dashboard load.
      if (from) {
        params.push(from);
        query += ` AND ts >= $${params.length}`;
      } else {
        const defaultFrom = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
        params.push(defaultFrom);
        query += ` AND ts >= $${params.length}`;
      }

      if (to) {
        params.push(to);
        query += ` AND ts <= $${params.length}`;
      }

      query += ` GROUP BY route, method ORDER BY total_revenue DESC`;

      // Fetch one extra row to detect whether there are more groups than the
      // limit. If there are, the extra row is rolled into an aggregated
      // "(other)" bucket so the response always carries correct totals.
      const fetchLimit = limit + 1;
      query += ` LIMIT $${params.length + 1}`;
      params.push(fetchLimit);

      const result = await client.query(query, params);
      return result.rows;
    });

    interface RouteRow {
      route: string;
      method: string | null;
      total_revenue: string;
      calls: number;
    }

    let routes: RouteRow[] = rows.map((r) => ({
      route: String(r.route),
      method: String(r.method),
      total_revenue: String(r.total_revenue),
      calls: Number(r.calls),
    }));

    let truncated = false;
    if (routes.length > limit) {
      truncated = true;
      const kept = routes.slice(0, limit);
      const tail = routes.slice(limit);
      const otherRevenue = tail.reduce(
        (sum, r) =>
          sum + (typeof r.total_revenue === 'string' ? BigInt(r.total_revenue) : BigInt(0)),
        0n,
      );
      const otherCalls = tail.reduce((sum, r) => sum + r.calls, 0);
      const otherRow = {
        route: '(other)',
        method: null as string | null,
        total_revenue: String(otherRevenue),
        calls: otherCalls,
      };
      routes = [...kept, otherRow];
    }

    return NextResponse.json({
      routes,
      truncated,
      default_window_days: from ? null : DEFAULT_WINDOW_DAYS,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
