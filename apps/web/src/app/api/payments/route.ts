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
  /** Sum of all settled payment amounts for this merchant. */
  total_amount?: string;
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

  // Date range filter (#142): ?from=ISO-8601&to=ISO-8601
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  let fromDate: Date | null = null;
  let toDate: Date | null = null;

  if (fromParam) {
    fromDate = new Date(fromParam);
    if (Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: 'from must be a valid ISO-8601 date' }, { status: 400 });
    }
  }
  if (toParam) {
    toDate = new Date(toParam);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'to must be a valid ISO-8601 date' }, { status: 400 });
    }
  }

  const offset = (page - 1) * limit;

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows, sync } = await withMerchantClient(
      merchant.id,
      async (client) => {
        await ensureSchema(client);

        let query = `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts, route, method,
                           COUNT(*) OVER() AS total,
                           COALESCE(SUM(amount) OVER(), 0) AS total_amount,
                           CASE WHEN MIN(COALESCE(asset, 'native')) OVER() =
                                     MAX(COALESCE(asset, 'native')) OVER()
                                THEN MIN(COALESCE(asset, 'native')) OVER() END AS total_asset
                    FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL`;
        const params: (string | number)[] = [merchant.id];

        // Apply date range filter (#142)
        if (fromDate) {
          query += ` AND ts >= $${params.length + 1}`;
          params.push(fromDate.toISOString());
        }
        if (toDate) {
          query += ` AND ts <= $${params.length + 1}`;
          params.push(toDate.toISOString());
        }

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
        return { rows: result.rows, sync: await getSyncState(client, merchant.id) };
      },
    );

    const total = rows.length > 0 ? Number(rows[0].total ?? 0) : 0;
    const totalAmount = rows.length > 0 ? String(rows[0].total_amount ?? 0) : '0';
    const totalAsset = rows.length > 0 ? (rows[0].total_asset ?? null) : null;
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
