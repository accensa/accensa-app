import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('TOTP Rate Limit Memory Fallback and Window', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.useFakeTimers();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it('should fallback to memory limit when Redis env vars are absent and track attempts', async () => {
    const { checkTotpRateLimit, resetTotpRateLimitForTests, TOTP_MAX_ATTEMPTS } = await import('./totp-rate-limit');
    resetTotpRateLimitForTests();

    const merchantId = 301;

    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const res = await checkTotpRateLimit(merchantId);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }

    const exceeded = await checkTotpRateLimit(merchantId);
    expect(exceeded.success).toBe(false);
    expect(exceeded.remaining).toBe(0);
  });

  it('should reset rate limit window after TOTP_WINDOW_SECONDS expires', async () => {
    const { checkTotpRateLimit, resetTotpRateLimitForTests, TOTP_MAX_ATTEMPTS, TOTP_WINDOW_SECONDS } = await import('./totp-rate-limit');
    resetTotpRateLimitForTests();

    const merchantId = 302;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);

    // Advance time past the rate limit window
    vi.advanceTimersByTime(TOTP_WINDOW_SECONDS * 1000 + 1000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
  });

  it('should isolate rate limits across different merchant IDs', async () => {
    const { checkTotpRateLimit, resetTotpRateLimitForTests, TOTP_MAX_ATTEMPTS } = await import('./totp-rate-limit');
    resetTotpRateLimitForTests();

    const merchantA = 303;
    const merchantB = 304;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantA);
    }

    const merchantABlock = await checkTotpRateLimit(merchantA);
    expect(merchantABlock.success).toBe(false);

    const merchantBFirst = await checkTotpRateLimit(merchantB);
    expect(merchantBFirst.success).toBe(true);
    expect(merchantBFirst.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });
});
