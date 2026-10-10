import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { isAdmin } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const ALLOWED_PERMISSIONS = new Set(['read', 'write', 'admin']);

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const keys = await withMerchantClient(merchant.id, async (client) => {
    await ensureSchema(client);
    const result = await client.query<{
      id: string;
      name: string;
      key_prefix: string;
      permissions: string[];
      created_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, name, key_prefix, permissions, created_at, revoked_at
       FROM merchant_api_keys WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchant.id],
    );
    return result.rows;
  });
  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL)
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdmin(request))
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object')
    return NextResponse.json({ error: 'Invalid API key request' }, { status: 400 });
  const input = body as { name?: unknown; permissions?: unknown; revokeId?: unknown };

  if (input.revokeId !== undefined) {
    if (typeof input.revokeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.revokeId)) {
      return NextResponse.json({ error: 'Invalid key id' }, { status: 400 });
    }
    const revoked = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query(
        `UPDATE merchant_api_keys SET revoked_at = now()
         WHERE merchant_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [merchant.id, input.revokeId],
      );
      return result.rowCount === 1;
    });
    return NextResponse.json({ revoked }, { status: revoked ? 200 : 404 });
  }

  const permissions = Array.isArray(input.permissions) ? input.permissions : ['read'];
  if (
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
    permissions.length < 1 ||
    permissions.some(
      (permission) => typeof permission !== 'string' || !ALLOWED_PERMISSIONS.has(permission),
    )
  ) {
    return NextResponse.json(
      { error: 'A name and valid permissions are required' },
      { status: 400 },
    );
  }

  const name = input.name.trim();
  const secret = `sk_live_${randomBytes(32).toString('base64url')}`;
  const id = randomUUID();
  const keyPrefix = secret.slice(0, 16);
  const secretHash = createHash('sha256').update(secret).digest('hex');
  await withMerchantClient(merchant.id, async (client) => {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO merchant_api_keys (id, merchant_id, name, key_prefix, secret_hash, permissions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, merchant.id, name, keyPrefix, secretHash, [...new Set(permissions)]],
    );
  });
  return NextResponse.json(
    { id, secret },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
