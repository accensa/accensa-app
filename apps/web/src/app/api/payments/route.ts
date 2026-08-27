import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema, getSyncState } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isHash32 } from '@/lib/receipt-anchor';
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
  next_cursor?: string | null;
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
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return NextResponse.json(
        { error: 'limit must be an integer between 1 and 1000' },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const cursor = searchParams.get('cursor');
  let parsedCursor: { ts: string; txHash: string } | null = null;
  if (cursor) {
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

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rows, sync } = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);

      let query = `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts, route, method FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL`;
      const params: (string | number)[] = [merchant.id];
      if (parsedCursor) {
        query += ` AND (ts < $${params.length + 1} OR (ts = $${params.length + 1} AND tx_hash < $${params.length + 2}))`;
        params.push(parsedCursor.ts, parsedCursor.txHash);
      }

      query += ` ORDER BY ts DESC, tx_hash DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await client.query(query, params);
      return { rows: result.rows, sync: await getSyncState(client, merchant.id) };
    });

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
