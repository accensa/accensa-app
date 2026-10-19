import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkTotpRateLimit,
  resetTotpRateLimitForTests,
  TOTP_MAX_ATTEMPTS,
  TOTP_WINDOW_SECONDS,
} from './totp-rate-limit';

describe('TOTP Rate Limit (in-memory)', () => {
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    resetTotpRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTotpRateLimitForTests();
    if (originalUpstashUrl === undefined) {
      delete process.env.UPSTASH_REDIS_REST_URL;
    } else {
      process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl;
    }
    if (originalUpstashToken === undefined) {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    } else {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken;
    }
  });

  it('succeeds up to TOTP_MAX_ATTEMPTS and decrements remaining', async () => {
    const merchantId = 'merchant-alpha';
    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }
  });

  it('returns success: false on the attempt past the cap without decrementing further', async () => {
    const merchantId = 'merchant-beta';
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets the counter once the clock passes the window duration', async () => {
    const merchantId = 'merchant-gamma';
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    let blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);

    vi.advanceTimersByTime((TOTP_WINDOW_SECONDS + 1) * 1000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
    expect(recovered.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('keeps independent windows for different merchant IDs', async () => {
    const merchantOne = 'merchant-one';
    const merchantTwo = 'merchant-two';

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantOne);
    }

    const resOne = await checkTotpRateLimit(merchantOne);
    expect(resOne.success).toBe(false);

    const resTwo = await checkTotpRateLimit(merchantTwo);
    expect(resTwo.success).toBe(true);
    expect(resTwo.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('falls back to the memory path when Redis is not configured', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    vi.resetModules();
    const { checkTotpRateLimit: freshCheck, resetTotpRateLimitForTests: freshReset } = await import(
      './totp-rate-limit'
    );
    freshReset();

    const merchantId = 'merchant-fallback';
    const result = await freshCheck(merchantId);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });
});
