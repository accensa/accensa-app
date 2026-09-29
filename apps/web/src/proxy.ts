import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
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

/**
 * Builds the per-request Content-Security-Policy (with a fresh nonce) that page
 * requests are served with.
 *
 * This lived in `middleware.ts` until Next.js 16 stopped allowing a
 * `middleware.ts` alongside a `proxy.ts` in the same app; the logic was merged
 * here so the nonce-based CSP and the security hardening headers survive.
 * Only page requests carry them — JSON API responses never did.
 */
function securityHeaderValues(): { csp: string; nonce: string } {
  const nonce = btoa(crypto.randomUUID());

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    connect-src 'self' https: wss:;
    upgrade-insecure-requests;
  `;

  return { csp: cspHeader.replace(/\s{2,}/g, ' ').trim(), nonce };
}

/** Attaches the security hardening headers to a response. */
function harden(response: NextResponse, csp: string): NextResponse {
  // API requests carry no nonce-CSP (csp is empty there); they still get the
  // lockdown headers below, which main's middleware applied to every response.
  if (csp) {
    response.headers.set('Content-Security-Policy', csp);
  }
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export default async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPageRequest = !path.startsWith('/api/');

  // Page requests get a per-request CSP nonce, propagated to the app router
  // through the request headers (server components read `x-nonce`) and echoed
  // on the response so the browser enforces it.
  const { csp, nonce } = isPageRequest ? securityHeaderValues() : { csp: '', nonce: '' };
  const requestHeaders = new Headers(request.headers);
  if (isPageRequest) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
  }

  const hardenedNext = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return harden(response, csp);
  };

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
      return harden(
        NextResponse.json(
          { error: 'Server misconfigured: JWT_SECRET_KEY is not set' },
          {
            status: 500,
          },
        ),
        csp,
      );
    }

    const sessionCookie = request.cookies.get('accensa_session')?.value;
    if (!sessionCookie) {
      if (isPrivateApi)
        return harden(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
      return harden(NextResponse.redirect(new URL('/login', request.url)), csp);
    }

    try {
      const { payload } = await jwtVerify(sessionCookie, key, { algorithms: ['HS256'] });
      const merchantAddress = typeof payload.publicKey === 'string' ? payload.publicKey : null;
      if (isPrivateApi && !merchantAddress) {
        // A session with no identifiable merchant cannot be scoped to any
        // tenant's data — treat it the same as no session at all.
        return harden(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
      }

      // RBAC (#156): the role rides in the signed session. Legacy sessions
      // without a role claim default to admin, so an existing cookie is never
      // locked out of the dashboard mid-deployment.
      const role: Role = parseRole(payload.role) ?? 'admin';

      // Route handlers trust this header for merchant scoping instead of each
      // re-verifying and re-decoding the session cookie themselves. It is only
      // ever set here, after jwtVerify has succeeded, so a request cannot
      // forge it — the proxy runs before the request reaches a route handler
      // and this header is set on the *outgoing* request, overwriting any
      // value a caller tried to smuggle in.
      requestHeaders.set('x-accensa-merchant', merchantAddress ?? '');
      requestHeaders.set('x-accensa-role', role);
      return hardenedNext();
    } catch {
      if (isPrivateApi)
        return harden(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
      return harden(NextResponse.redirect(new URL('/login', request.url)), csp);
    }
  }

  // Enforce CRON_SECRET for GET /api/sync and GET /api/webhooks/deliver
  if (isCronSync) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return harden(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), csp);
    }
  }

  return hardenedNext();
}

export const config = {
  // Everything except Next's own build artefacts, so the session gate covers
  // `/dashboard` and `/api` and the security headers cover every document.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
