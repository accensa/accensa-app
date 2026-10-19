import { describe, expect, it } from 'vitest';
import { DELIVERY_WINDOW_MS, MAX_ATTEMPTS, MAX_BACKOFF_MS } from './constants.ts';
import { backoffMs, nextRetryAt, parseRetryAfter, shouldRetry } from './retry-policy.ts';

describe('shouldRetry', () => {
  it('retries transport failures regardless of status', () => {
    expect(shouldRetry(null, true)).toBe(true);
    expect(shouldRetry(404, true)).toBe(true);
  });

  it('retries null status, 429, and 5xx responses', () => {
    expect(shouldRetry(null, false)).toBe(true);
    expect(shouldRetry(429, false)).toBe(true);
    expect(shouldRetry(500, false)).toBe(true);
    expect(shouldRetry(599, false)).toBe(true);
  });

  it('does not retry 4xx responses other than 429', () => {
    expect(shouldRetry(400, false)).toBe(false);
    expect(shouldRetry(404, false)).toBe(false);
    expect(shouldRetry(499, false)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.UTC(2026, 0, 1);

  it('parses delta-seconds relative to the injected current time', () => {
    expect(parseRetryAfter('120', now)).toBe(now + 120_000);
  });

  it('parses an HTTP-date as an absolute epoch time', () => {
    const date = 'Wed, 21 Oct 2026 07:28:00 GMT';
    expect(parseRetryAfter(date, now)).toBe(Date.parse(date));
  });

  it.each([null, undefined, '', '   ', 'not-a-date'])(
    'returns null for an empty or invalid value (%s)',
    (header) => {
      expect(parseRetryAfter(header, now)).toBeNull();
    },
  );

  it('returns null when reading the header throws', () => {
    const throwingHeader = {
      trim() {
        throw new Error('header read failed');
      },
    } as unknown as string;

    expect(parseRetryAfter(throwingHeader, now)).toBeNull();
  });
});

describe('backoffMs', () => {
  it('doubles the base delay for successive attempts when jitter is zero', () => {
    expect(backoffMs(1, () => 0)).toBe(1_000);
    expect(backoffMs(2, () => 0)).toBe(2_000);
    expect(backoffMs(3, () => 0)).toBe(4_000);
  });

  it('caps the exponential base at MAX_BACKOFF_MS', () => {
    expect(backoffMs(100, () => 0)).toBe(MAX_BACKOFF_MS);
  });

  it('adds between zero and 25 percent jitter using the injected random source', () => {
    expect(backoffMs(1, () => 0)).toBe(1_000);
    expect(backoffMs(1, () => 0.5)).toBe(1_125);
    expect(backoffMs(1, () => 1)).toBe(1_250);
  });
});

describe('nextRetryAt', () => {
  const createdAtMs = Date.UTC(2026, 0, 1);

  it('returns null when the delivery window has elapsed', () => {
    expect(
      nextRetryAt({
        attempt: 1,
        createdAtMs,
        now: createdAtMs + DELIVERY_WINDOW_MS,
        random: () => 0,
      }),
    ).toBeNull();
  });

  it('returns null when the attempt limit is reached', () => {
    expect(
      nextRetryAt({
        attempt: MAX_ATTEMPTS,
        createdAtMs,
        now: createdAtMs,
        random: () => 0,
      }),
    ).toBeNull();
  });

  it('uses the later of Retry-After and the computed backoff', () => {
    const now = createdAtMs + 10_000;

    expect(
      nextRetryAt({
        attempt: 1,
        createdAtMs,
        now,
        retryAfterHeader: '30',
        random: () => 0,
      }),
    ).toEqual(new Date(now + 30_000));

    expect(
      nextRetryAt({
        attempt: 1,
        createdAtMs,
        now,
        retryAfterHeader: '0',
        random: () => 0,
      }),
    ).toEqual(new Date(now + 1_000));
  });

  it('returns null when the selected retry time would exceed the delivery window', () => {
    const now = createdAtMs + DELIVERY_WINDOW_MS - 10_000;

    expect(
      nextRetryAt({
        attempt: 1,
        createdAtMs,
        now,
        retryAfterHeader: '30',
        random: () => 0,
      }),
    ).toBeNull();
  });
});
