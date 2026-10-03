import { NextResponse } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { webhookSummary } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/** Merchant-visible webhook delivery status. Session-authenticated via middleware. */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!process.env.WEBHOOK_URL) {
      return NextResponse.json({
        configured: false,
        pending: 0,
        failed: 0,
        deadLetter: 0,
        delivered: 0,
        lag: 0,
        recentFailed: [],
        recentDeliveries: [],
      });
    }

    const summary = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      return webhookSummary(client, merchant.id);
    });
    return NextResponse.json({ configured: true, ...summary });
  } catch (error: unknown) {
    console.error('webhook summary failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
