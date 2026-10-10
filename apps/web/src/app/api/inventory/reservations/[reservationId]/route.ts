import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantById } from '@/lib/merchants';
import {
  InventoryReservationManager,
  PostgresInventoryReservationStore,
} from '@/lib/inventory/reservationManager';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ reservationId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 503 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid reservation update' }, { status: 400 });
  }
  const body = payload as { merchantId?: unknown; action?: unknown };
  const { reservationId } = await params;
  if (
    !Number.isSafeInteger(body.merchantId) ||
    (body.action !== 'commit' && body.action !== 'release') ||
    !/^[0-9a-f-]{36}$/i.test(reservationId)
  ) {
    return NextResponse.json({ error: 'Invalid reservation update' }, { status: 400 });
  }

  const merchantId = body.merchantId as number;
  try {
    const merchant = await withClient((client) => getMerchantById(client, merchantId));
    if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    const updated = await withMerchantClient(merchantId, async (client) => {
      await ensureSchema(client);
      return new InventoryReservationManager(new PostgresInventoryReservationStore(client)).finish(
        merchantId,
        reservationId,
        body.action as 'commit' | 'release',
      );
    });
    return NextResponse.json({ updated }, { status: updated ? 200 : 409 });
  } catch (error) {
    console.error('Unable to update inventory reservation:', error);
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 500 });
  }
}
