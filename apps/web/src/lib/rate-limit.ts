import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '60 s'),
  analytics: true,
  prefix: 'accensa:ratelimit',
});

export async function rateLimit(ip: string) {
  return limiter.limit(ip);
}
