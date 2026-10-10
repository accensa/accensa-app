import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantById } from '@/lib/merchants';
import {
  InventoryReservationManager,
  PostgresInventoryReservationStore,
  type InventoryLine,
} from '@/lib/inventory/reservationManager';
import { allowInventoryReservation } from '@/lib/inventory/reservation-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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
    return NextResponse.json({ error: 'Invalid reservation request' }, { status: 400 });
  }
  const body = payload as { merchantId?: unknown; checkoutId?: unknown; items?: unknown };
  if (
    !Number.isSafeInteger(body.merchantId) ||
    typeof body.checkoutId !== 'string' ||
    !Array.isArray(body.items)
  ) {
    return NextResponse.json({ error: 'Invalid reservation request' }, { status: 400 });
  }

  const merchantId = body.merchantId as number;
  const forwardedFor =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const ip = forwardedFor.split(',')[0].trim();
  if (!(await allowInventoryReservation(merchantId, ip))) {
    return NextResponse.json({ error: 'Too many reservation attempts' }, { status: 429 });
  }
  try {
    const merchant = await withClient((client) => getMerchantById(client, merchantId));
    if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    const result = await withMerchantClient(merchantId, async (client) => {
      await ensureSchema(client);
      return new InventoryReservationManager(new PostgresInventoryReservationStore(client)).reserve(
        {
          merchantId,
          checkoutId: body.checkoutId as string,
          items: body.items as InventoryLine[],
        },
      );
    });

    if (!result.ok) {
      const status =
        result.reason === 'item_not_found' ? 404 : result.reason === 'checkout_expired' ? 410 : 409;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Unable to reserve inventory:', error);
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 500 });
  }
}
