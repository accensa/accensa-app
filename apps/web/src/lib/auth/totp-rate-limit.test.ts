import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('totp-rate-limit memory and fallback behavior', () => {
  const originalEnv = {
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv.UPSTASH_REDIS_REST_URL !== undefined) {
      process.env.UPSTASH_REDIS_REST_URL = originalEnv.UPSTASH_REDIS_REST_URL;
    } else {
      delete process.env.UPSTASH_REDIS_REST_URL;
    }
    if (originalEnv.UPSTASH_REDIS_REST_TOKEN !== undefined) {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalEnv.UPSTASH_REDIS_REST_TOKEN;
    } else {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('succeeds up to TOTP_MAX_ATTEMPTS and decreases remaining, then blocks on cap', async () => {
    const {
      checkTotpRateLimit,
      resetTotpRateLimitForTests,
      TOTP_MAX_ATTEMPTS,
    } = await import('./totp-rate-limit');

    resetTotpRateLimitForTests();

    const merchantId = 301;

    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets counter after advancing fake time past the rate limit window', async () => {
    const {
      checkTotpRateLimit,
      resetTotpRateLimitForTests,
      TOTP_MAX_ATTEMPTS,
      TOTP_WINDOW_SECONDS,
    } = await import('./totp-rate-limit');

    resetTotpRateLimitForTests();

    const merchantId = 302;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    let res = await checkTotpRateLimit(merchantId);
    expect(res.success).toBe(false);

    // Advance time just past the rate limit window
    vi.advanceTimersByTime(TOTP_WINDOW_SECONDS * 1000 + 1000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
  });

  it('maintains independent windows for different merchant ids', async () => {
    const {
      checkTotpRateLimit,
      resetTotpRateLimitForTests,
      TOTP_MAX_ATTEMPTS,
    } = await import('./totp-rate-limit');

    resetTotpRateLimitForTests();

    const merchantA = 303;
    const merchantB = 304;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantA);
    }

    expect((await checkTotpRateLimit(merchantA)).success).toBe(false);
    expect((await checkTotpRateLimit(merchantB)).success).toBe(true);
  });
});
