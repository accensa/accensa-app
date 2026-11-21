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
/**
 * Maximum number of distinct client identifiers tracked simultaneously in the
 * process-local fallback.
 *
 * Each entry holds a 64-character SHA-256 hex key and at most
 * MAX_RESERVATIONS_PER_MINUTE (12) numeric timestamps, so a cap of 10,000
 * bounds the fallback to roughly a few megabytes under traffic spikes or
 * distributed scanning instead of growing without limit.
 */
export const MAX_TRACKED_CLIENTS = 10_000;

const localHits = new Map<string, number[]>();

/** Test hook: the number of currently tracked client identifiers. */
export function getLocalHitsSizeForTests(): number {
  return localHits.size;
}

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

  // Sweep keys whose last recorded hit has left the window. Keys are re-inserted
  // on every allowed hit, so they are ordered by their most recent hit timestamp
  // and the sweep can stop at the first key that is still live.
  for (const [tracked, timestamps] of localHits) {
    const newest = timestamps.length > 0 ? timestamps[timestamps.length - 1]! : 0;
    if (newest <= windowStart) {
      localHits.delete(tracked);
    } else {
      break;
    }
  }

  const hits = (localHits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (hits.length >= MAX_RESERVATIONS_PER_MINUTE) {
    // Never store an emptied window: keys with no live timestamps are dropped.
    if (hits.length === 0) localHits.delete(key);
    else localHits.set(key, hits);
    return false;
  }
  hits.push(now);

  // Bound the map: evict the least recently active client before adding a new one.
  if (!localHits.has(key) && localHits.size >= MAX_TRACKED_CLIENTS) {
    const oldestKey = localHits.keys().next().value;
    if (oldestKey !== undefined) localHits.delete(oldestKey);
  }

  // Re-insert so the map stays ordered by each key's most recent hit.
  localHits.delete(key);
  localHits.set(key, hits);
  return true;
}

export function resetInventoryReservationLimitsForTests(): void {
  localHits.clear();
}
