import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkTotpRateLimit,
  resetTotpRateLimitForTests,
  TOTP_MAX_ATTEMPTS,
  TOTP_WINDOW_SECONDS,
} from './totp-rate-limit';

describe('TOTP Rate Limiter', () => {
  const merchantId = 301;
  const otherMerchantId = 302;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetTotpRateLimitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('allows up to TOTP_MAX_ATTEMPTS and decrements remaining', async () => {
    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }
  });

  it('returns success: false on the attempt past the cap', async () => {
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }
    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets counter after advancing clock past the window', async () => {
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }
    expect((await checkTotpRateLimit(merchantId)).success).toBe(false);

    // Advance time just past the rate limit window
    vi.advanceTimersByTime(TOTP_WINDOW_SECONDS * 1000 + 1000);

    const afterWindow = await checkTotpRateLimit(merchantId);
    expect(afterWindow.success).toBe(true);
    expect(afterWindow.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('maintains independent rate-limit windows per merchant id', async () => {
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }
    expect((await checkTotpRateLimit(merchantId)).success).toBe(false);

    const otherResult = await checkTotpRateLimit(otherMerchantId);
    expect(otherResult.success).toBe(true);
    expect(otherResult.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('reaches the memory path when Redis environment is absent', async () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      vi.resetModules();
      const rateLimitModule = await import('./totp-rate-limit');
      rateLimitModule.resetTotpRateLimitForTests();

      const result = await rateLimitModule.checkTotpRateLimit(303);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
    } finally {
      if (originalUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = originalUrl;
      if (originalToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
      vi.resetModules();
    }
  });
});
