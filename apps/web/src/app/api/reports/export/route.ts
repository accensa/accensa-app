import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { createCsvStream } from '@/lib/export/csvFormatter';
import { paymentsCsvFilename, CsvPayment } from '@/lib/payments-csv';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);

  // Filter parameters
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

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Define generator to fetch batches
    async function* fetchPaymentBatches(): AsyncGenerator<CsvPayment[]> {
      let offset = 0;
      const limit = 500;
      let hasMore = true;

      while (hasMore) {
        let batch: CsvPayment[] = [];
        await withMerchantClient(merchant!.id, async (client) => {
          await ensureSchema(client);

          const predicates: string[] = [];
          const params: (string | number)[] = [merchant!.id];

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
          const baseQuery = `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts, route, method 
                             FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL${filterSql} 
                             ORDER BY ts DESC, tx_hash DESC`;

          const query = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
          const currentParams = [...params, limit, offset];

          const result = await client.query(query, currentParams);
          batch = result.rows.map((r) => ({
            ...r,
            ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
          }));
        });

        if (batch.length === 0) {
          hasMore = false;
        } else {
          yield batch;
          offset += limit;
          if (batch.length < limit) {
            hasMore = false;
          }
        }
      }
    }

    const stream = createCsvStream(fetchPaymentBatches());

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${paymentsCsvFilename()}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error: unknown) {
    console.error('Error exporting payments:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
