import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkTotpRateLimit, resetTotpRateLimitForTests, TOTP_MAX_ATTEMPTS } from './totp-rate-limit';

describe('TOTP Rate Limit In-Memory Fallback (#536)', () => {
  const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    resetTotpRateLimitForTests();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalRedisUrl !== undefined) {
      process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl;
    }
    if (originalRedisToken !== undefined) {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken;
    }
  });

  it('succeeds up to TOTP_MAX_ATTEMPTS and decrements remaining, then fails past the cap', async () => {
    const merchantId = 'merchant-test-1';

    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }

    const blockedResult = await checkTotpRateLimit(merchantId);
    expect(blockedResult.success).toBe(false);
    expect(blockedResult.remaining).toBe(0);
  });

  it('resets the counter and succeeds again once the clock passes the window', async () => {
    const merchantId = 'merchant-test-2';

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      const res = await checkTotpRateLimit(merchantId);
      expect(res.success).toBe(true);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);

    // Advance time past the 60s rate limit window
    vi.advanceTimersByTime(61000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
    expect(recovered.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('keeps independent windows for different merchant ids', async () => {
    const merchantA = 'merchant-a';
    const merchantB = 'merchant-b';

    // Exhaust attempts for merchantA
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantA);
    }

    const blockedA = await checkTotpRateLimit(merchantA);
    expect(blockedA.success).toBe(false);

    // merchantB should still succeed independently
    const successB = await checkTotpRateLimit(merchantB);
    expect(successB.success).toBe(true);
    expect(successB.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });
});
