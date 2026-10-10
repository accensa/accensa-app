import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantById } from '@/lib/merchants';
import {
  InventoryReservationManager,
  PostgresInventoryReservationStore,
} from '@/lib/inventory/reservationManager';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ merchantId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const merchantId = Number((await params).merchantId);
  if (!Number.isSafeInteger(merchantId) || merchantId < 1) {
    return NextResponse.json({ error: 'Invalid merchant id' }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 503 });
  }

  const skus = new URL(request.url).searchParams.getAll('sku');
  if (skus.length > 50 || skus.some((sku) => !/^[A-Za-z0-9._:-]{1,100}$/.test(sku))) {
    return NextResponse.json({ error: 'Invalid SKU filter' }, { status: 400 });
  }

  try {
    const merchant = await withClient((client) => getMerchantById(client, merchantId));
    if (!merchant) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
    const items = await withMerchantClient(merchantId, async (client) => {
      await ensureSchema(client);
      return new InventoryReservationManager(
        new PostgresInventoryReservationStore(client),
      ).stockLevels(merchantId, skus.length ? skus : null);
    });
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Unable to read merchant inventory:', error);
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 500 });
  }
}
