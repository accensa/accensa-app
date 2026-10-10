import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';
import { requeueFailedDelivery } from '@/lib/webhooks';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Delivery ID must be a positive integer' }, { status: 400 });
  }
  if (!process.env.WEBHOOK_URL) {
    return NextResponse.json({ error: 'Webhook delivery is not configured' }, { status: 503 });
  }

  try {
    const merchant = await withClient((client) => getMerchantFromRequest(client, request));
    if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const queued = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      return requeueFailedDelivery(client, id, merchant.id);
    });
    if (!queued) {
      return NextResponse.json(
        { error: 'Only failed or dead-letter deliveries can be redelivered' },
        { status: 409 },
      );
    }
    return NextResponse.json({ queued: true, id }, { status: 202 });
  } catch (error: unknown) {
    console.error('webhook redelivery enqueue failed:', error);
    return NextResponse.json({ error: 'Could not queue webhook redelivery' }, { status: 500 });
  }
}
