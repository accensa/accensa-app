import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';
import {
  InventoryReservationManager,
  PostgresInventoryReservationStore,
} from '@/lib/inventory/reservationManager';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 503 });
  }
  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const items = await withMerchantClient(merchant.id, async (client) => {
    await ensureSchema(client);
    return new InventoryReservationManager(
      new PostgresInventoryReservationStore(client),
    ).stockLevels(merchant.id);
  });
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 503 });
  }
  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(request)) {
    return NextResponse.json(
      { error: 'Only merchant admins can change inventory' },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { items?: unknown }).items) ||
    (payload as { items: unknown[] }).items.length > 100
  ) {
    return NextResponse.json(
      { error: 'items must be an array with at most 100 entries' },
      { status: 400 },
    );
  }

  try {
    const updates = (payload as { items: unknown[] }).items;
    const result = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const manager = new InventoryReservationManager(
        new PostgresInventoryReservationStore(client),
      );
      for (const item of updates) {
        if (!item || typeof item !== 'object') throw new TypeError('Invalid inventory item');
        const input = item as {
          sku?: unknown;
          name?: unknown;
          stockQuantity?: unknown;
          lowStockThreshold?: unknown;
        };
        if (
          typeof input.sku !== 'string' ||
          typeof input.name !== 'string' ||
          !Number.isSafeInteger(input.stockQuantity) ||
          !Number.isSafeInteger(input.lowStockThreshold)
        ) {
          throw new TypeError('Invalid inventory item');
        }
        const updated = await manager.setStockLevel({
          merchantId: merchant.id,
          sku: input.sku,
          name: input.name,
          stockQuantity: input.stockQuantity as number,
          lowStockThreshold: input.lowStockThreshold as number,
        });
        if (!updated) return false;
      }
      return true;
    });
    if (!result) {
      return NextResponse.json(
        { error: 'Stock cannot be lower than active reservations' },
        { status: 409 },
      );
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Unable to update merchant inventory:', error);
    return NextResponse.json({ error: 'Inventory is unavailable' }, { status: 500 });
  }
}
