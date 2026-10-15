import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema, getSyncState } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { getMaxBatchSize, isHash32 } from '@/lib/receipt-anchor';
import type { SyncState } from '@/lib/sync-status';

export const dynamic = 'force-dynamic';

export interface PaymentRow {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  /** Decimal string. Deliberately not a number - see below. */
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
}

export interface PaymentsResponse {
  payments: PaymentRow[];
  /** Null until the indexer has run at least once. */
  sync: SyncState | null;
  /** Opaque keyset cursor for the next page; null when the list is exhausted. */
  next_cursor?: string | null;
  /** Total number of indexed payments for this merchant. */
  total: number;
  /** Sum of every payment amount, as a decimal string. */
  total_amount: string;
  /** Raw asset when every payment is in one asset, else null. */
  total_asset: string | null;
  /** ceil(total / limit); 0 when there are no payments. */
  total_pages: number;
  /** Total count of all settled payments for this merchant. */
  total_count?: number;
  /** Echoes the filters applied to this query (#167). */
  filter_info?: {
    route?: string;
    payer?: string;
    asset?: string;
    date_from?: string;
    date_to?: string;
  };
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  let limit = 100;
  if (limitParam !== null) {
    const parsed = Number.parseFloat(limitParam);
    const maxLimit = await getMaxBatchSize().catch(() => 1000);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
      return NextResponse.json(
        { error: 'limit must be an integer between 1 and 1000' },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const pageParam = searchParams.get('page');
  let page = 1;
  if (pageParam !== null) {
    const parsed = Number.parseFloat(pageParam);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json({ error: 'page must be an integer >= 1' }, { status: 400 });
    }
    page = parsed;
  }

  const cursor = searchParams.get('cursor');
  let parsedCursor: { ts: string; txHash: string } | null = null;
  if (cursor) {
    if (pageParam !== null) {
      return NextResponse.json({ error: 'page and cursor cannot be combined' }, { status: 400 });
    }
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const parts = decoded.split('|');
      if (parts.length !== 2) throw new Error();

      const [ts, txHash] = parts;
      const date = new Date(ts);
      if (Number.isNaN(date.getTime())) throw new Error();
      if (!isHash32(txHash)) throw new Error();

      parsedCursor = { ts, txHash };
    } catch {
      return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
    }
  }

  // Unknown query parameters are rejected rather than silently ignored, so a
  // typo in a dashboard or SDK filter surfaces as a 400 instead of an
  // unfiltered response that looks correct (#167).
  const ALLOWED_PARAMS = new Set([
    'limit',
    'page',
    'cursor',
    'route',
    'payer',
    'asset',
    'date_from',
    'date_to',
  ]);
  for (const key of searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) {
      return NextResponse.json({ error: `unknown parameter: ${key}` }, { status: 400 });
    }
  }

  // Filter parameters (#167): ?route=&payer=&asset=&date_from=&date_to=
  const filterRoute = searchParams.get('route');
  const filterPayer = searchParams.get('payer');
  const filterAsset = searchParams.get('asset');
  const filterDateFrom = searchParams.get('date_from');
  const filterDateTo = searchParams.get('date_to');

  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (filterDateFrom) {
    fromDate = new Date(filterDateFrom);
    if (Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: 'date_from must be a valid date' }, { status: 400 });
    }
  }
  if (filterDateTo) {
    toDate = new Date(filterDateTo);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'date_to must be a valid date' }, { status: 400 });
    }
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return NextResponse.json({ error: 'date_from must be on or before date_to' }, { status: 400 });
  }

  const offset = (page - 1) * limit;

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows, sync, total, totalAmount, totalAsset } = await withMerchantClient(
      merchant.id,
      async (client) => {
        await ensureSchema(client);

        // The same predicate list feeds the page query and the aggregate
        // query, so the header totals always cover the filtered set (#167).
        const predicates: string[] = [];
        const params: (string | number)[] = [merchant.id];
        if (filterRoute) {
          predicates.push(`route = $${params.length + 1}`);
          params.push(filterRoute);
        }
        if (filterPayer) {
          predicates.push(`payer = $${params.length + 1}`);
          params.push(filterPayer);
        }
        if (filterAsset) {
          predicates.push(`asset = $${params.length + 1}`);
          params.push(filterAsset);
        }
        if (fromDate) {
          predicates.push(`ts >= $${params.length + 1}`);
          params.push(fromDate.toISOString());
        }
        if (toDate) {
          predicates.push(`ts <= $${params.length + 1}`);
          params.push(toDate.toISOString());
        }
        const filterSql = predicates.length ? ` AND ${predicates.join(' AND ')}` : '';

        // The page query returns rows only. Totals come from the aggregate
        // query below, never from the page: a page past the end has no rows to
        // read them off, and a cursor page's rows exclude everything before
        // the cursor.
        let query = `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts, route, method
                    FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL${filterSql}`;

        if (parsedCursor) {
          query += ` AND (ts < $${params.length + 1} OR (ts = $${params.length + 1} AND tx_hash < $${params.length + 2}))`;
          params.push(parsedCursor.ts, parsedCursor.txHash);
        }
        query += ` ORDER BY ts DESC, tx_hash DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        if (!parsedCursor) {
          query += ` OFFSET $${params.length + 1}`;
          params.push(offset);
        }

        const result = await client.query(query, params);

        // The single source of every reported total. It covers the same
        // filtered set as the page but takes only the tenant-scope and filter
        // prefix of params, so neither the cursor nor LIMIT/OFFSET narrows it.
        // Single-asset detection is min = max over the set. The sum is cast
        // to text so the amount stays a decimal string end to end.
        const aggregateParams = params.slice(0, predicates.length + 1);
        const aggregate = await client.query<{
          total_count: string;
          total_amount: string;
          total_asset: string | null;
        }>(
          `SELECT count(*)::text AS total_count,
                  coalesce(sum(amount), 0)::text AS total_amount,
                  CASE WHEN min(coalesce(asset, 'native')) = max(coalesce(asset, 'native'))
                       THEN min(coalesce(asset, 'native')) END AS total_asset
           FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL${filterSql}`,
          aggregateParams,
        );
        // An aggregate without GROUP BY always yields one row; the fallback
        // only guards a driver that returns none.
        const totals = aggregate.rows[0];

        return {
          rows: result.rows,
          sync: await getSyncState(client, merchant.id),
          total: totals ? Number(totals.total_count) : 0,
          totalAmount: totals?.total_amount ?? '0',
          totalAsset: totals?.total_asset ?? null,
        };
      },
    );

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    const next_cursor =
      rows.length === limit
        ? Buffer.from(
            `${rows[rows.length - 1].ts instanceof Date ? rows[rows.length - 1].ts.toISOString() : rows[rows.length - 1].ts}|${rows[rows.length - 1].tx_hash}`,
          ).toString('base64')
        : null;

    const body: PaymentsResponse = {
      payments: rows.map((row): PaymentRow => ({
        tx_hash: row.tx_hash,
        ledger: row.ledger === null ? null : Number(row.ledger),
        payer: row.payer,
        amount: String(row.amount),
        asset: row.asset,
        ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
        route: row.route,
        method: row.method,
      })),
      sync,
      next_cursor,
      total,
      total_amount: totalAmount,
      total_asset: totalAsset,
      total_pages: totalPages,
      total_count: total,
      ...(filterRoute || filterPayer || filterAsset || filterDateFrom || filterDateTo
        ? {
            filter_info: {
              route: filterRoute ?? undefined,
              payer: filterPayer ?? undefined,
              asset: filterAsset ?? undefined,
              date_from: filterDateFrom ?? undefined,
              date_to: filterDateTo ?? undefined,
            },
          }
        : {}),
    };
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching payments:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    );
  }
}
