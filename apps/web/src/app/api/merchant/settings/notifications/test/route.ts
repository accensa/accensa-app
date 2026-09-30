import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';
import {
  dispatchChatNotification,
  getChatNotifierConfig,
  type ChatPlatform,
} from '@/lib/notifications/chatNotifier';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  let platform: ChatPlatform;
  try {
    const body = await request.json();
    if (body?.platform !== 'telegram' && body?.platform !== 'discord') throw new Error();
    platform = body.platform;
  } catch {
    return NextResponse.json({ error: 'Platform must be telegram or discord' }, { status: 400 });
  }

  const merchant = await withClient(async (client) => {
    await ensureSchema(client);
    return getMerchantFromRequest(client, request);
  });
  if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const config = await withMerchantClient(merchant.id, (client) =>
      getChatNotifierConfig(client, merchant.id),
    );
    await dispatchChatNotification(platform, config, {
      event: 'settlement',
      amount: '1.00',
      asset: 'USDC',
      customerAddress: 'Test notification',
      txHash: '0'.repeat(64),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Test notification failed' },
      { status: 502 },
    );
  }
}
