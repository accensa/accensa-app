import { jwtVerify } from 'jose';
import { parseRole, type Role } from '@/lib/rbac';

/**
 * The caller's verified session identity, decoded from the signed
 * `accensa_session` cookie.
 */
export interface SessionIdentity {
  /** The signed-in merchant's Stellar address (the session's `publicKey` claim). */
  publicKey: string;
  /** The role from the signed session; sessions predating RBAC default to admin. */
  role: Role;
}

/**
 * Resolves the caller's merchant and role from the verified session cookie.
 *
 * The proxy (`src/proxy.ts`) sets `x-accensa-merchant` / `x-accensa-role` only
 * on the paths it session-verifies. `/api/auth` is in its public-path list, so
 * requests there — including the TOTP routes — reach the handler with those
 * headers untouched, meaning a caller can supply any value it likes. Routes on
 * public paths therefore must not read the headers; they must verify the
 * `accensa_session` cookie themselves with this helper, exactly as the proxy
 * would have, and treat "no valid session" as unauthorized.
 *
 * Returns `null` when the cookie is missing, malformed, expired, lacks `exp`,
 * or signed under a different key — or when the payload carries no merchant
 * address (a session with no identifiable merchant cannot be scoped to any
 * tenant). Same-name cookies are tried in order; the first identity that
 * verifies is returned, so a stale wide-path cookie cannot shadow a live one.
 * A missing `JWT_SECRET_KEY` throws rather than falling back: a deployment
 * without the secret must fail loudly, never silently skip verification.
 */
export async function sessionFromRequest(request: Request): Promise<SessionIdentity | null> {
  const secretKey = process.env.JWT_SECRET_KEY;
  if (!secretKey) {
    throw new Error('JWT_SECRET_KEY is not set; refusing to verify a session');
  }

  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const key = new TextEncoder().encode(secretKey);

  // Collect every accensa_session= candidate. Same-name cookies are legal and
  // ordered by path specificity; a stale wider-path cookie can otherwise shadow
  // the live session. We try each in order and return the first valid identity.
  // The exact prefix filter (with the '=') avoids matching accensa_session_old=.
  const candidates = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('accensa_session='))
    .map((part) => part.slice('accensa_session='.length));

  for (const raw of candidates) {
    const identity = await identityFromToken(raw, key);
    if (identity) return identity;
  }

  return null;
}

/**
 * Decodes one raw (URL-encoded) cookie value and verifies it as a session JWT.
 *
 * Returns `null` on any failure — expired, missing `exp`, wrong key, malformed
 * URI, missing `publicKey` — so the caller can move on to the next candidate.
 */
async function identityFromToken(raw: string, key: Uint8Array): Promise<SessionIdentity | null> {
  try {
    const token = decodeURIComponent(raw);
    if (!token) return null;
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      requiredClaims: ['exp'],
    });
    if (typeof payload.publicKey !== 'string' || !payload.publicKey) return null;
    // Legacy sessions minted before roles existed carry no role claim and
    // default to admin — the same compatibility rule the proxy applies on
    // session-verified paths. The cookie is signed, so this default is never
    // caller-controllable (unlike the forwarded header on public paths).
    return { publicKey: payload.publicKey, role: parseRole(payload.role) ?? 'admin' };
  } catch {
    return null;
  }
}
