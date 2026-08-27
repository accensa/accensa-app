import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

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
    path.startsWith('/api/verify') || path.startsWith('/api/auth') || path.startsWith('/api/hook/');
  const isCronSync = path === '/api/sync' && request.method === 'GET';
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

      // Route handlers trust this header for merchant scoping instead of each
      // re-verifying and re-decoding the session cookie themselves. It is only
      // ever set here, after jwtVerify has succeeded, so a request cannot
      // forge it — Next.js middleware runs before the request reaches a route
      // handler and this header is set on the *outgoing* request, overwriting
      // any value a caller tried to smuggle in.
      const headers = new Headers(request.headers);
      headers.set('x-accensa-merchant', merchantAddress ?? '');
      return NextResponse.next({ request: { headers } });
    } catch {
      if (isPrivateApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // Enforce CRON_SECRET for GET /api/sync.
  //
  // The bearer-token comparison itself lives in the route handler
  // (isAuthorizedCronRequest, src/lib/cron-auth.ts): it needs node:crypto's
  // constant-time compare, which this middleware's Edge runtime doesn't
  // have. Re-implementing that comparison here with `!==` is exactly how it
  // previously drifted - an unset CRON_SECRET rendered this template literal
  // as the string "Bearer undefined", which a request carrying that literal
  // header then matched. So this only asserts what is true unconditionally:
  // with no secret configured, no header can ever be valid, and denying here
  // means a misconfigured deployment never even reaches the route.
  if (isCronSync && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
