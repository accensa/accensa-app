/**
 * Role-based access control for the merchant dashboard (#156).
 *
 * Merchants can grant staff read-only access to orders without handing over
 * the ability to change settings or move money. Two roles exist:
 *
 * - `admin` — the full dashboard: settings, webhook config, refunds.
 * - `viewer` — can view payments and revenue, but cannot reach developer
 *   settings, webhook configs, refunds, or any mutation endpoint.
 *
 * The role rides inside the signed session JWT (see `lib/auth.ts`) and is
 * forwarded to route handlers by `src/proxy.ts` as the `x-accensa-role`
 * header, exactly like the merchant address is forwarded as
 * `x-accensa-merchant`. On the paths the proxy session-verifies, server
 * routes re-read the header instead of trusting anything a caller supplies.
 *
 * The proxy only sets the header on those session-verified paths. `/api/auth`
 * is in its public-path list, so requests there are forwarded with the header
 * untouched — a caller can set it to anything, and a missing value would
 * default to `admin`. Routes on public paths must read the role from the
 * verified session instead (`lib/auth/request-session.ts`); see
 * `roleFromRequest` below.
 *
 * Legacy sessions minted before roles existed carry no role claim; they are
 * treated as `admin` so a 24-hour-old cookie cannot lock a merchant out of
 * their own dashboard mid-deployment. New sessions always carry an explicit
 * role.
 */

export type Role = 'admin' | 'viewer';

export const ROLES: readonly Role[] = ['admin', 'viewer'];

/** Parses a role claim, rejecting anything that is not a known role. */
export function parseRole(value: unknown): Role | null {
  return typeof value === 'string' && (value === 'admin' || value === 'viewer') ? value : null;
}

/**
 * The caller's role, from the proxy-set header.
 *
 * Missing or unknown values resolve to `admin` for backward compatibility
 * with pre-RBAC sessions (see the module comment). That default is only safe
 * where the proxy has already run its session gate: the proxy sets the header
 * after `jwtVerify` succeeds and overwrites any caller-supplied value on
 * session-verified paths, but on its public paths (e.g. `/api/auth`) the
 * header is forwarded untouched and a caller can forge it. Do not call this
 * on a public-path route — read the role from the verified session instead
 * (`lib/auth/request-session.ts`).
 */
export function roleFromRequest(request: Request): Role {
  return parseRole(request.headers.get('x-accensa-role')) ?? 'admin';
}

/** True when the caller may perform admin-only actions. */
export function isAdmin(request: Request): boolean {
  return roleFromRequest(request) === 'admin';
}
