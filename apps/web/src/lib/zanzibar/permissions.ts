/**
 * Route-level authorization helpers for the App Router (#180).
 *
 * Next.js App Router routes do not share an express-style middleware stack,
 * so `requirePermission` here is an async function: call it at the top of a
 * route with the merchant id from middleware's x-accensa-merchant header and
 * the permission the action needs. It returns a NextResponse (401/403) when
 * the call is not allowed, and null when it is.
 *
 * The check runs against the Zanzibar model in zanzibar/schema.ts via the
 * client in zanzibar/store.ts — SpiceDB when provisioned, the Postgres tuple
 * store otherwise. It is edge-safe (no Node-only APIs), so the same helper
 * guards edge functions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withMerchantClient } from '@/lib/db';
import { zanzibarClient } from './store';
import { objectOf, permissionOf, type WildcardPermission } from './schema';

export type AuthzResult = NextResponse | null;

/**
 * Checks that the request's merchant grants `permission` to `subject`
 * (a `user:<id>` ref, normally taken from the JWT's sub).
 *
 * Middleware forwards the signed-in merchant as x-accensa-merchant; the
 * subject comes from the session (x-accensa-sub). A caller that bypasses
 * middleware (e.g. a cron) should pass an explicit merchant id and subject.
 */
export async function authorize(
  permission: WildcardPermission | string,
  opts: {
    merchant?: { id: number } | null;
    subject?: string | null;
    request?: NextRequest | Request;
  },
): Promise<AuthzResult> {
  const permissionName = permissionOf(permission);
  if (!permissionName) {
    return NextResponse.json({ error: `unknown permission: ${permission}` }, { status: 400 });
  }

  const merchant = opts.merchant;
  if (!merchant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let subject = opts.subject;
  if (!subject && opts.request) {
    const headers = opts.request.headers;
    subject =
      headers.get('x-accensa-sub') ??
      headers.get('authorization')?.replace(/^Bearer\s+/, '');
  }
  if (!subject) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userRef = subject.startsWith('user:') ? subject : `user:${subject}`;

  const allowed = await withMerchantClient(merchant.id, async (client) => {
    const z = zanzibarClient(client);
    if (!z) return false;
    return z.check(objectOf(merchant.id), permissionName, userRef);
  });

  if (!allowed) {
    return NextResponse.json(
      { error: `Permission denied: ${permissionName}` },
      { status: 403 },
    );
  }
  return null;
}

/** Convenience: true/false variant for route bodies that don't want 401/403. */
export async function can(
  permission: WildcardPermission,
  opts: Parameters<typeof authorize>[1],
): Promise<boolean> {
  return (await authorize(permission, opts)) === null;
}