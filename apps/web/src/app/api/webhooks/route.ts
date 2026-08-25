import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { webhookSummary } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

/** Merchant-visible webhook delivery status. Session-authenticated via middleware. */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  if (!process.env.WEBHOOK_URL) {
    return NextResponse.json({
      configured: false,
      pending: 0,
      failed: 0,
      delivered: 0,
      recentFailed: [],
    });
  }

  try {
    const summary = await withClient(async (client) => {
      await ensureSchema(client);
      return webhookSummary(client);
    });
    return NextResponse.json({ configured: true, ...summary });
  } catch (error: unknown) {
    console.error('webhook summary failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
