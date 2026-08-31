import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { withClient, withMerchantClient, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { zanzibarClient } from '@/lib/zanzibar/store';
import { objectOf, RELATIONS } from '@/lib/zanzibar/schema';
import { authorize } from '@/lib/zanzibar/permissions';

export const dynamic = 'force-dynamic';

/** Fixed set of relations a merchant can grant on its own object. */
const GRANTABLE_RELATIONS = new Set<string>([
  RELATIONS.OWNER,
  RELATIONS.EDITOR,
  RELATIONS.VIEWER,
]);

function subjectFromRequest(request: NextRequest): string | null {
  return request.headers.get('x-accensa-sub');
}

/**
 * GET /api/roles — the merchant's current role tuples.
 *
 * Read side of the dashboard's membership UI (#180): merchants can see who
 * holds which role on their store. Guarded by view_dashboard, which the
 * owner/editor/viewer relations all grant.
 */
export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await authorize('view_dashboard', {
    merchant,
    subject: subjectFromRequest(request),
    request,
  });
  if (denied) return denied;

  const tuples = await withMerchantClient(merchant.id, async (client): Promise<unknown[]> => {
    await ensureSchema(client);
    const store = zanzibarClient(client);
    if (!store) return [];
    const owns = await store.list(objectOf(merchant.id));
    return owns;
  });

  return NextResponse.json({ merchant: merchant.id, roles: tuples });
}

/**
 * POST /api/roles — grant (or revoke when present) a role on a merchant.
 *
 * Body: { subject: "user:<id>" | "group:<id>#member", relation: "owner" |
 * "editor" | "viewer", revoke?: boolean }. Guarded by manage_team (owner only).
 * The write path goes through the same RLS-scoped connection as every other
 * tenant write.
 */
export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const denied = await authorize('manage_team', {
    merchant,
    subject: subjectFromRequest(request),
    request,
  });
  if (denied) return denied;

  let body: { subject?: unknown; relation?: unknown; revoke?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { subject, relation } = body;
  const revoke = body.revoke === true;

  if (typeof subject !== 'string' || !/^(user:[A-Za-z0-9_-]+|group:[A-Za-z0-9_-]+#member)$/.test(subject)) {
    return NextResponse.json(
      { error: 'subject must be "user:<id>" or "group:<id>#member"' },
      { status: 400 },
    );
  }
  if (typeof relation !== 'string' || !GRANTABLE_RELATIONS.has(relation)) {
    return NextResponse.json(
      { error: `relation must be one of: ${[...GRANTABLE_RELATIONS].join(', ')}` },
      { status: 400 },
    );
  }

  const object = objectOf(merchant.id);
  await withMerchantClient(merchant.id, async (client): Promise<void> => {
    await ensureSchema(client);
    if (revoke) {
      await client.query(
        `DELETE FROM role_tuples WHERE merchant_id = $1 AND relation = $2 AND "user" = $3`,
        [merchant.id, relation, subject],
      );
    } else {
      await client.query(
        `INSERT INTO role_tuples (object, relation, "user", merchant_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (object, relation, "user") DO NOTHING`,
        [object, relation, subject, merchant.id],
      );
    }
  });

  return NextResponse.json(
    { merchant: merchant.id, granted: revoke ? false : true, subject, relation },
    { status: revoke ? 200 : 201 },
  );
}