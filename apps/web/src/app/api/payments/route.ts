import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export interface PaymentRow {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  /** Decimal string. Deliberately not a number — see below. */
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const rows = await withClient(async (client) => {
      await ensureSchema(client);
      const result = await client.query(
        `SELECT tx_hash, ledger, payer, amount::text AS amount, asset,
                ts, route, method
           FROM payments
          WHERE ts IS NOT NULL
       ORDER BY ts DESC
          LIMIT 100`,
      );
      return result.rows;
    });

    // amount is cast to text in SQL and stays a string all the way to the
    // client. node-postgres already returns NUMERIC as a string to avoid
    // precision loss; making that explicit stops anyone "fixing" it into a
    // Number later, which is how money silently loses cents.
    return NextResponse.json(
      rows.map(
        (row): PaymentRow => ({
          tx_hash: row.tx_hash,
          ledger: row.ledger === null ? null : Number(row.ledger),
          payer: row.payer,
          amount: String(row.amount),
          asset: row.asset,
          ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
          route: row.route,
          method: row.method,
        }),
      ),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
