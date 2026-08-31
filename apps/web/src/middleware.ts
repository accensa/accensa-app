import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { rateLimit } from '@/lib/rate-limit';
import { parseRole, type Role } from '@/lib/rbac';

/**
 * No fallback secret, deliberately.
 *
 * This previously read `process.env.JWT_SECRET_KEY || 'default_secret_key_for_development'`.
 * That string is published in this repository, so any deployment missing the variable
 * would have verified session cookies against a value the whole world can read — anyone
 * could mint a valid `accensa_session` and the dashboard would look authenticated while
 * being open. A missing secret must deny, never fall back.
 */
const secretKey = process.env.JWT_SECRET_KEY;
const key = secretKey ? new TextEncoder().encode(secretKey) : null;

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define public and private paths.
  //
  // `/api/hook/settle` is deliberately NOT session-authenticated. It is called by a
  // seller's server through `@accensa/sdk`, which cannot hold a browser cookie, and it
  // carries its own stronger auth: an Ed25519 signature verified over the raw request
  // bytes plus a five-minute timestamp bound. Gating it here would 401 every legitimate
  // settlement report before its own verification ever ran.
  const isPublicApi =
    path.startsWith('/api/verify') ||
    path.startsWith('/api/auth') ||
    path.startsWith('/api/hook/') ||
    path.startsWith('/api/receipts/');
  const isCronSync =
    (path === '/api/sync' || path === '/api/webhooks/deliver') && request.method === 'GET';
  const isPrivateApi = path.startsWith('/api/') && !isPublicApi && !isCronSync;
  const isDashboard = path.startsWith('/dashboard');

  if (isPrivateApi || isDashboard) {
    if (!key) {
      // Fail closed. A deployment without JWT_SECRET_KEY serves nothing private.
      return NextResponse.json(
        { error: 'Server misconfigured: JWT_SECRET_KEY is not set' },
        { status: 500 },
      );
    }

    const sessionCookie = request.cookies.get('accensa_session')?.value;
    if (!sessionCookie) {
      if (isPrivateApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      const { payload } = await jwtVerify(sessionCookie, key, { algorithms: ['HS256'] });
      const merchantAddress = typeof payload.publicKey === 'string' ? payload.publicKey : null;
      if (isPrivateApi && !merchantAddress) {
        // A session with no identifiable merchant cannot be scoped to any
        // tenant's data — treat it the same as no session at all.
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // RBAC (#156): the role rides in the signed session. Legacy sessions
      // without a role claim default to admin, so an existing cookie is never
      // locked out of the dashboard mid-deployment.
      const role: Role = parseRole(payload.role) ?? 'admin';

      // Route handlers trust this header for merchant scoping instead of each
      // re-verifying and re-decoding the session cookie themselves. It is only
      // ever set here, after jwtVerify has succeeded, so a request cannot
      // forge it — Next.js middleware runs before the request reaches a route
      // handler and this header is set on the *outgoing* request, overwriting
      // any value a caller tried to smuggle in.
      const headers = new Headers(request.headers);
      headers.set('x-accensa-merchant', merchantAddress ?? '');
      headers.set('x-accensa-role', role);
      return NextResponse.next({ request: { headers } });
      await jwtVerify(sessionCookie, key, { algorithms: ['HS256'] });
      return NextResponse.next();
    } catch {
      if (isPrivateApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // Enforce CRON_SECRET for GET /api/sync and GET /api/webhooks/deliver
  if (isCronSync) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
