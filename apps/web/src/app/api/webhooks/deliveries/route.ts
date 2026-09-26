import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { deliverDue } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const deliveries = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query(
        `SELECT d.id, d.url, d.payment_tx_hash AS "paymentTxHash", d.payload,
                d.status, d.attempts, d.last_status_code AS "lastStatusCode",
                d.last_error AS "lastError", d.created_at AS "createdAt",
                d.updated_at AS "updatedAt",
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', a.id,
                    'attemptNumber', a.attempt_number,
                    'statusCode', a.status_code,
                    'error', a.error,
                    'durationMs', a.duration_ms,
                    'createdAt', a.created_at
                  ) ORDER BY a.attempt_number DESC)
                  FROM webhook_attempts a WHERE a.delivery_id = d.id
                ), '[]'::json) AS "attemptLog"
         FROM webhook_deliveries d
         JOIN payments p ON p.tx_hash = d.payment_tx_hash
         WHERE p.merchant_id = $1
         ORDER BY d.updated_at DESC
         LIMIT 100`,
        [merchant.id],
      );
      return result.rows;
    });

    return NextResponse.json({
      configured: Boolean(merchant.webhookUrl ?? process.env.WEBHOOK_URL),
      endpoint: merchant.webhookUrl ?? process.env.WEBHOOK_URL ?? null,
      signatureConfigured: Boolean(process.env.WEBHOOK_SECRET),
      deliveries,
    });
  } catch (error: unknown) {
    console.error('webhook delivery log failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  let body: { deliveryId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const deliveryId = body?.deliveryId;
  if (!Number.isSafeInteger(deliveryId) || Number(deliveryId) < 1) {
    return NextResponse.json({ error: 'deliveryId must be a positive integer' }, { status: 400 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const outcome = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const updated = await client.query(
        `UPDATE webhook_deliveries d
         SET status = 'pending', next_retry_at = now(), last_error = NULL, updated_at = now()
         WHERE d.id = $1
           AND d.status IN ('failed', 'dead_letter')
           AND EXISTS (
             SELECT 1 FROM payments p
             WHERE p.tx_hash = d.payment_tx_hash AND p.merchant_id = $2
           )
         RETURNING d.id`,
        [deliveryId, merchant.id],
      );
      if (!updated.rowCount) return null;
      return deliverDue(client, { deliveryId: Number(deliveryId), merchantId: merchant.id });
    });

    if (!outcome) {
      return NextResponse.json(
        { error: 'Failed delivery not found for this merchant' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, ...outcome });
  } catch (error: unknown) {
    console.error('webhook redelivery failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
