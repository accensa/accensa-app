import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkTotpRateLimit,
  resetTotpRateLimitForTests,
  TOTP_MAX_ATTEMPTS,
  TOTP_WINDOW_SECONDS,
} from './totp-rate-limit';

describe('TOTP Rate Limit (In-Memory Fallback)', () => {
  beforeEach(() => {
    resetTotpRateLimitForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    resetTotpRateLimitForTests();
  });

  it('succeeds and decrements remaining for up to TOTP_MAX_ATTEMPTS calls', async () => {
    const merchantId = 101;

    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }
  });

  it('returns success: false once the cap is reached without recording further', async () => {
    const merchantId = 102;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      const res = await checkTotpRateLimit(merchantId);
      expect(res.success).toBe(true);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked).toEqual({ success: false, remaining: 0 });

    // Another call past cap remains blocked
    const blockedAgain = await checkTotpRateLimit(merchantId);
    expect(blockedAgain).toEqual({ success: false, remaining: 0 });
  });

  it('resets the counter and succeeds once the clock advances past the window', async () => {
    const merchantId = 103;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    expect((await checkTotpRateLimit(merchantId)).success).toBe(false);

    // Advance clock past TOTP_WINDOW_SECONDS
    vi.advanceTimersByTime((TOTP_WINDOW_SECONDS + 1) * 1000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
    expect(recovered.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('keeps different merchant IDs rate-limited independently', async () => {
    const merchantA = 201;
    const merchantB = 202;

    // Exhaust merchant A
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantA);
    }
    expect((await checkTotpRateLimit(merchantA)).success).toBe(false);

    // Merchant B should still have full quota
    const resB = await checkTotpRateLimit(merchantB);
    expect(resB.success).toBe(true);
    expect(resB.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('reaches the memory path correctly when Redis environment variables are absent', async () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      const merchantId = 301;
      const res = await checkTotpRateLimit(merchantId);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
    } finally {
      if (originalUrl) process.env.UPSTASH_REDIS_REST_URL = originalUrl;
      if (originalToken) process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    }
  });
});
