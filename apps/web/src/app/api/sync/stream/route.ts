import { NextResponse, type NextRequest } from 'next/server';
import { withClient } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { createSyncStream } from '@/lib/sync-events';

export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events subscription for indexer updates.
 *
 * `GET /api/sync/stream` keeps a connection open and pushes a `sync` event
 * each time the indexer finishes a run for the signed-in merchant. The
 * dashboard and SDK subscribe here instead of polling `/api/sync`, which is
 * what removes the polling load described in the real-time update issue.
 *
 * Authentication mirrors the other API routes: `apps/web/src/middleware.ts`
 * verifies the session cookie and forwards the merchant address as
 * `x-accensa-merchant`, which `getMerchantFromRequest` trusts.
 */
export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const merchant = await withClient((client) => getMerchantFromRequest(client, request));
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return createSyncStream(request, merchant.id);
}
