import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { deliverDue, pendingDue } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Ships queued payment webhooks.
 *
 * Protected by CRON_SECRET the same way GET /api/sync is. Indexing never
 * calls this — a hung merchant endpoint can only delay itself.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  try {
    const result = await withClient(async (client) => {
      await ensureSchema(client);
      const outcome = await deliverDue(client);
      // Remaining lag after this run: the signal a scheduler uses to scale
      // consumer frequency to backlog (#165).
      const lag = await pendingDue(client);
      return { ...outcome, lag };
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('webhook delivery failed:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
