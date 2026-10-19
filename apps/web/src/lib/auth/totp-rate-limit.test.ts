// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkTotpRateLimit,
  resetTotpRateLimitForTests,
  TOTP_MAX_ATTEMPTS,
  TOTP_WINDOW_SECONDS,
} from './totp-rate-limit';

describe('TOTP rate limiter in-memory fallback', () => {
  const originalEnv = process.env.UPSTASH_REDIS_REST_URL;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    resetTotpRateLimitForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.UPSTASH_REDIS_REST_URL;
    } else {
      process.env.UPSTASH_REDIS_REST_URL = originalEnv;
    }
    vi.useRealTimers();
    resetTotpRateLimitForTests();
  });

  it('allows attempts up to TOTP_MAX_ATTEMPTS and decrements remaining count', async () => {
    const merchantId = 123;
    for (let i = 1; i <= TOTP_MAX_ATTEMPTS; i++) {
      const result = await checkTotpRateLimit(merchantId);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(TOTP_MAX_ATTEMPTS - i);
    }
  });

  it('rejects attempts past TOTP_MAX_ATTEMPTS with success false and remaining 0', async () => {
    const merchantId = 456;
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }
    const blockedResult = await checkTotpRateLimit(merchantId);
    expect(blockedResult.success).toBe(false);
    expect(blockedResult.remaining).toBe(0);
  });

  it('resets counter after advancing the clock past the window', async () => {
    const merchantId = 789;
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }
    expect((await checkTotpRateLimit(merchantId)).success).toBe(false);

    vi.advanceTimersByTime((TOTP_WINDOW_SECONDS + 1) * 1000);

    const recoveredResult = await checkTotpRateLimit(merchantId);
    expect(recoveredResult.success).toBe(true);
    expect(recoveredResult.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('maintains independent rate limit windows for different merchant ids', async () => {
    const m1 = 111;
    const m2 = 222;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(m1);
    }
    expect((await checkTotpRateLimit(m1)).success).toBe(false);

    const m2Result = await checkTotpRateLimit(m2);
    expect(m2Result.success).toBe(true);
    expect(m2Result.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('exercises memory fallback when Redis env is absent', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const result = await checkTotpRateLimit(999);
    expect(result.success).toBe(true);
  });
});
