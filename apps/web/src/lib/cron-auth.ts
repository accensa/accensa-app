import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time bearer-token check for GET /api/sync.
 *
 * Fails closed: an unset `CRON_SECRET` can never be satisfied by any header,
 * matching how `middleware.ts` treats a missing `JWT_SECRET_KEY` ("a missing
 * secret must deny, never fall back"). Previously this compared with `!==`
 * and a `secret && ...` guard that skipped the check entirely when the
 * variable was unset, so a request carrying the literal header
 * `Authorization: Bearer undefined` matched the template literal produced by
 * the missing secret.
 *
 * This is the single owner of the comparison - middleware.ts asserts the
 * unset-secret case on its own instead of re-implementing this check,
 * because it runs on the Edge runtime where `node:crypto` isn't available.
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
