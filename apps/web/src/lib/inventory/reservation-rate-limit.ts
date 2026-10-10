import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_RESERVATIONS_PER_MINUTE = 12;
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
      limiter: Ratelimit.slidingWindow(MAX_RESERVATIONS_PER_MINUTE, '60 s'),
      analytics: false,
      prefix: 'accensa:inventory-reservations',
    })
  : null;
const localHits = new Map<string, number[]>();

export async function allowInventoryReservation(
  merchantId: number,
  ip: string,
  now = Date.now(),
): Promise<boolean> {
  const key = createHash('sha256').update(`${merchantId}:${ip}`).digest('hex');
  if (limiter) {
    try {
      return (await limiter.limit(key)).success;
    } catch (error) {
      console.error('Inventory rate limiter failed; using process-local fallback:', error);
    }
  }

  const windowStart = now - 60_000;
  const hits = (localHits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (hits.length >= MAX_RESERVATIONS_PER_MINUTE) {
    localHits.set(key, hits);
    return false;
  }
  hits.push(now);
  localHits.set(key, hits);
  return true;
}

export function resetInventoryReservationLimitsForTests(): void {
  localHits.clear();
}
