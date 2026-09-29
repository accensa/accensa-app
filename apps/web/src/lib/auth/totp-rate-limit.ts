import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Dedicated, strict limiter for TOTP code verification (#411).
 *
 * A 6-digit TOTP code is a small keyspace: without a tight limit on attempts
 * per secret, a code can be brute-forced inside its 30-second window. Login
 * and every sensitive-settings mutation funnel their 2FA challenge through
 * this limiter, keyed by merchant so one tenant's attacker cannot lock out
 * another's codes.
 *
 * Upstash Redis is the primary counter (like `lib/rate-limit.ts`) so limits
 * hold across serverless instances. When `UPSTASH_REDIS_REST_URL`/`TOKEN` are
 * not configured — every dev environment and the test suite — a per-process
 * in-memory window takes over: weaker than a shared counter, but far better
 * than failing open, and it keeps the strict limit from breaking local login.
 */

/** Max attempts inside the window before verification is blocked. */
export const TOTP_MAX_ATTEMPTS = 5;
/** How long a blocking window lasts once attempts start counting. */
export const TOTP_WINDOW_SECONDS = 300;

const PREFIX = 'accensa:totp';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(TOTP_MAX_ATTEMPTS, `${TOTP_WINDOW_SECONDS} s`),
      analytics: false,
      prefix: PREFIX,
    })
  : null;

const memoryHits = new Map<string, number[]>();
let warnedAboutFallback = false;

function memoryLimit(merchantId: number): { success: boolean; remaining: number } {
  if (!warnedAboutFallback && process.env.NODE_ENV === 'production') {
    warnedAboutFallback = true;
    console.warn(
      'UPSTASH_REDIS_REST_URL/TOKEN not set; TOTP attempt limiting is per-process memory. ' +
        'Configure Upstash in production so limits hold across instances.',
    );
  }
  const now = Date.now();
  const windowStart = now - TOTP_WINDOW_SECONDS * 1000;
  const hits = (memoryHits.get(String(merchantId)) ?? []).filter((t) => t > windowStart);
  if (hits.length >= TOTP_MAX_ATTEMPTS) {
    memoryHits.set(String(merchantId), hits);
    return { success: false, remaining: 0 };
  }
  hits.push(now);
  memoryHits.set(String(merchantId), hits);
  return { success: true, remaining: TOTP_MAX_ATTEMPTS - hits.length };
}

/**
 * Checks whether the merchant may attempt a 2FA verification right now.
 *
 * Called *before* evaluating the submitted code; a blocked caller receives
 * 429 without learning whether a code would have been valid. Successful
 * verifications clear the counter (see `clearTotpAttempts`) so a merchant who
 * mistypes once is not carrying the attempt toward a future lockout forever.
 */
export async function checkTotpRateLimit(
  merchantId: number,
): Promise<{ success: boolean; remaining: number }> {
  if (limiter) {
    try {
      return await limiter.limit(`merchant:${merchantId}`);
    } catch (error) {
      console.error('TOTP rate limiter backend error; falling back to memory:', error);
    }
  }
  return memoryLimit(merchantId);
}

/** Clears the attempt counter after a successful verification. */
export async function clearTotpAttempts(merchantId: number): Promise<void> {
  memoryHits.delete(String(merchantId));
  if (redis) {
    try {
      // The Upstash sliding-window counter lives under `{prefix}:{identifier}`;
      // deleting it resets the window, which is exactly the post-success reset.
      await redis.del(`${PREFIX}:merchant:${merchantId}`);
    } catch {
      // A failure to clear only risks an over-strict window; never block login on it.
    }
  }
}

/** Test helper: resets the in-memory window between tests. */
export function resetTotpRateLimitForTests(): void {
  memoryHits.clear();
}
