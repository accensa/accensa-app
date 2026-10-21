import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time bearer-token check for GET /api/sync.
 *
 * Fails closed: an unset `CRON_SECRET` can never be satisfied by any header,
 * matching how `src/proxy.ts` treats a missing `JWT_SECRET_KEY` ("a missing
 * secret must deny, never fall back"). Previously this compared with `!==`
 * and a `secret && ...` guard that skipped the check entirely when the
 * variable was unset, so a request carrying the literal header
 * `Authorization: Bearer undefined` matched the template literal produced by
 * the missing secret.
 *
 * This is the single owner of the comparison - src/proxy.ts asserts the
 * unset-secret case on its own instead of re-implementing this check,
 * because it runs on the Edge runtime where `node:crypto` isn't available.
 *
 * GET /api/sync sits in the proxy's cron branch, separate from both the
 * session-verified paths and the public-path list: the proxy checks this
 * bearer token there and forwards the request without ever setting
 * `x-accensa-merchant` / `x-accensa-role`. Those headers are only set on
 * session-verified paths; on the public paths (`/api/auth`, `/api/verify`,
 * …) the proxy forwards them untouched, so a caller can forge them. Nothing
 * on the cron or public paths may assume the headers describe a verified
 * caller.
 */
export function isAuthorizedCronRequest(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = Buffer.from(authHeader ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);

  // timingSafeEqual throws on unequal-length buffers. A length mismatch is
  // itself a safe, cheap "no match" - it leaks only the header's length, not
  // anything about the secret's content, so it's fine to short-circuit here.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
