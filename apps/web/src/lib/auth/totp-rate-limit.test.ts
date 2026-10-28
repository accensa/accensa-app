import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let checkTotpRateLimit: typeof import('./totp-rate-limit').checkTotpRateLimit;
let resetTotpRateLimitForTests: typeof import('./totp-rate-limit').resetTotpRateLimitForTests;
let TOTP_MAX_ATTEMPTS: typeof import('./totp-rate-limit').TOTP_MAX_ATTEMPTS;
let TOTP_WINDOW_SECONDS: typeof import('./totp-rate-limit').TOTP_WINDOW_SECONDS;

describe('TOTP Rate Limit In-Memory & Fallback', () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(async () => {
    vi.useFakeTimers();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
    const mod = await import('./totp-rate-limit');
    checkTotpRateLimit = mod.checkTotpRateLimit;
    resetTotpRateLimitForTests = mod.resetTotpRateLimitForTests;
    TOTP_MAX_ATTEMPTS = mod.TOTP_MAX_ATTEMPTS;
    TOTP_WINDOW_SECONDS = mod.TOTP_WINDOW_SECONDS;
    resetTotpRateLimitForTests();
  });

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    } else {
      delete process.env.UPSTASH_REDIS_REST_URL;
    }
    if (originalToken !== undefined) {
      process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    } else {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('succeeds up to TOTP_MAX_ATTEMPTS and decrements remaining', async () => {
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

  it('resets counter after advancing the clock past the window', async () => {
    const merchantId = 302;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    const blocked = await checkTotpRateLimit(merchantId);
    expect(blocked.success).toBe(false);

    // Advance time just past the rate limit window
    vi.advanceTimersByTime(TOTP_WINDOW_SECONDS * 1000 + 1000);

    const recovered = await checkTotpRateLimit(merchantId);
    expect(recovered.success).toBe(true);
    expect(recovered.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('keeps independent windows for different merchant IDs', async () => {
    const merchantA = 303;
    const merchantB = 304;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantA);
    }

    const blockedA = await checkTotpRateLimit(merchantA);
    expect(blockedA.success).toBe(false);

    const successB = await checkTotpRateLimit(merchantB);
    expect(successB.success).toBe(true);
    expect(successB.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });

  it('allows explicit reset via resetTotpRateLimitForTests', async () => {
    const merchantId = 305;

    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      await checkTotpRateLimit(merchantId);
    }

    expect((await checkTotpRateLimit(merchantId)).success).toBe(false);

    resetTotpRateLimitForTests();

    const afterReset = await checkTotpRateLimit(merchantId);
    expect(afterReset.success).toBe(true);
    expect(afterReset.remaining).toBe(TOTP_MAX_ATTEMPTS - 1);
  });
});
