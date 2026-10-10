import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantByAddress } from '@/lib/merchants';
import { signActiveStoreToken } from '@/lib/stores/activeStoreToken';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is unavailable' }, { status: 503 });
  }
  const organizationAddress =
    request.headers.get('x-accensa-org-merchant') ?? request.headers.get('x-accensa-merchant');
  if (!organizationAddress) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Invalid store selection' }, { status: 400 });
  }
  const storeId = (payload as { storeId?: unknown }).storeId;
  if (
    !('storeId' in payload) ||
    (storeId !== null &&
      (typeof storeId !== 'number' || !Number.isSafeInteger(storeId) || storeId < 1))
  ) {
    return NextResponse.json(
      { error: 'storeId must be a positive integer or null' },
      { status: 400 },
    );
  }

  const organization = await withClient((client) =>
    getMerchantByAddress(client, organizationAddress),
  );
  if (!organization) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (storeId === null) {
    const response = NextResponse.json({ activeStoreId: null });
    response.cookies.set('accensa_active_store', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  }

  const store = await withMerchantClient(organization.id, async (client) => {
    await ensureSchema(client);
    const result = await client.query<{ id: number; address: string }>(
      `SELECT s.id, m.address FROM merchant_stores s
       JOIN merchants m ON m.id = s.store_merchant_id
       WHERE s.organization_merchant_id = $1 AND s.id = $2`,
      [organization.id, storeId],
    );
    return result.rows[0] ?? null;
  });
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  try {
    const token = await signActiveStoreToken(organization.address, store.address);
    const response = NextResponse.json({ activeStoreId: store.id });
    response.cookies.set('accensa_active_store', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Store selection is unavailable' }, { status: 500 });
  }
}
