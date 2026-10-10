import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantByAddress } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

function organizationAddress(request: Request): string | null {
  return request.headers.get('x-accensa-org-merchant') ?? request.headers.get('x-accensa-merchant');
}

async function organizationForRequest(request: Request) {
  const address = organizationAddress(request);
  if (!address) return null;
  return withClient((client) => getMerchantByAddress(client, address));
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is unavailable' }, { status: 503 });
  }
  try {
    const organization = await organizationForRequest(request);
    if (!organization) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const stores = await withMerchantClient(organization.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query<{
        id: number;
        merchant_id: number;
        address: string;
        name: string;
        created_at: Date;
      }>(
        `SELECT s.id, m.id AS merchant_id, m.address, s.name, s.created_at
         FROM merchant_stores s
         JOIN merchants m ON m.id = s.store_merchant_id
         WHERE s.organization_merchant_id = $1
         ORDER BY s.name, s.id`,
        [organization.id],
      );
      return result.rows;
    });
    const activeAddress = request.headers.get('x-accensa-merchant');
    return NextResponse.json({
      organization: { id: organization.id, address: organization.address },
      activeStoreId: stores.find((store) => store.address === activeAddress)?.id ?? null,
      stores: stores.map((store) => ({
        id: store.id,
        merchantId: store.merchant_id,
        address: store.address,
        name: store.name,
        createdAt: store.created_at,
      })),
    });
  } catch (error) {
    console.error('Unable to list merchant stores:', error);
    return NextResponse.json({ error: 'Unable to load stores' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is unavailable' }, { status: 503 });
  }
  if (!isAdmin(request)) {
    return NextResponse.json({ error: 'Only merchant admins can create stores' }, { status: 403 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid store' }, { status: 400 });
  }
  const body = payload as { name?: unknown; address?: unknown; refundVaultId?: unknown };
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.trim().length > 120 ||
    typeof body.address !== 'string' ||
    !/^G[A-Z2-7]{55}$/.test(body.address) ||
    (body.refundVaultId !== undefined &&
      body.refundVaultId !== null &&
      (typeof body.refundVaultId !== 'string' || !/^C[A-Z2-7]{55}$/.test(body.refundVaultId)))
  ) {
    return NextResponse.json(
      { error: 'A store name and valid Stellar address are required' },
      { status: 400 },
    );
  }
  const name = body.name.trim();
  const address = body.address;
  const refundVaultId = body.refundVaultId ?? null;

  const organization = await organizationForRequest(request);
  if (!organization) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let created: { id: number; merchantId: number; address: string; name: string };
  try {
    created = await withMerchantClient(organization.id, async (client) => {
      await ensureSchema(client);
      await client.query('BEGIN');
      try {
        const merchant = await client.query<{ id: number; address: string }>(
          `INSERT INTO merchants (address, refund_vault_id) VALUES ($1, $2)
           ON CONFLICT (address) DO NOTHING RETURNING id, address`,
          [address, refundVaultId],
        );
        if (!merchant.rows[0]) throw new Error('store_address_exists');
        const store = await client.query<{ id: number }>(
          `INSERT INTO merchant_stores (organization_merchant_id, store_merchant_id, name)
           VALUES ($1, $2, $3) RETURNING id`,
          [organization.id, merchant.rows[0].id, name],
        );
        await client.query('COMMIT');
        return {
          id: store.rows[0].id,
          merchantId: merchant.rows[0].id,
          address: merchant.rows[0].address,
          name,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });

    await withMerchantClient(created.merchantId, async (client) => {
      await client.query(
        `INSERT INTO role_tuples (object, relation, "user", merchant_id)
         VALUES ($1, 'owner', $2, $3)
         ON CONFLICT (object, relation, "user") DO NOTHING`,
        [`merchant:${created.merchantId}`, `user:${organization.address}`, created.merchantId],
      );
    });
    return NextResponse.json({ store: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'store_address_exists') {
      return NextResponse.json(
        { error: 'That merchant address is already configured' },
        { status: 409 },
      );
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'A store with that name already exists' }, { status: 409 });
    }
    console.error('Unable to create merchant store:', error);
    return NextResponse.json({ error: 'Unable to create store' }, { status: 500 });
  }
}
