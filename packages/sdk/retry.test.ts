import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry, HttpError, retryAfterMs } from './retry';

const ok = () => new Response(null, { status: 200 });
const status = (code: number) => new Response(null, { status: code });

/** Every test uses a 1ms base delay so exponential backoff doesn't slow the suite. */
const FAST = { baseDelayMs: 1 };

describe('fetchWithRetry', () => {
  it('returns the response on the first successful attempt', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok());

    const response = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
    });

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 503 up to 3 times by default, then throws HttpError', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(503));

    await expect(
      fetchWithRetry('https://example.test', undefined, { ...FAST, fetchImpl }),
    ).rejects.toThrow(HttpError);
    // The initial attempt plus 3 retries.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('retries a 504 the same way as a 503', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(504));

    const error = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(504);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('succeeds once the server recovers partway through retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(status(503));
    fetchImpl.mockResolvedValueOnce(status(503));
    fetchImpl.mockResolvedValueOnce(ok());

    const response = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
    });

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on a 400 without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(400));

    const error = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 404, 409, 422, 429])(
    'throws immediately on %i without retrying',
    async (code) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => status(code));

      await expect(
        fetchWithRetry('https://example.test', undefined, { ...FAST, fetchImpl }),
      ).rejects.toThrow(HttpError);
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it('retries a thrown network-level error the same way as a 5xx', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockRejectedValueOnce(new Error('ECONNRESET'));
    fetchImpl.mockRejectedValueOnce(new Error('ECONNRESET'));
    fetchImpl.mockResolvedValueOnce(ok());

    const response = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
    });

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws the original error after exhausting retries on a network failure', async () => {
    const networkError = new Error('ECONNREFUSED');
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw networkError;
    });

    await expect(
      fetchWithRetry('https://example.test', undefined, { ...FAST, fetchImpl }),
    ).rejects.toBe(networkError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('never retries an AbortError, since the caller already decided to stop waiting', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(
      fetchWithRetry('https://example.test', undefined, { ...FAST, fetchImpl }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('increases the delay exponentially between retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(503));
    const onRetry = vi.fn();

    await fetchWithRetry('https://example.test', undefined, {
      baseDelayMs: 10,
      maxRetries: 3,
      fetchImpl,
      onRetry,
    }).catch(() => {});

    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((call) => call[2])).toEqual([10, 20, 40]);
    // Attempt numbers passed to onRetry are 1-indexed retry counts.
    expect(onRetry.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
  });

  it('never calls onRetry for the final, unrecovered failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(503));
    const onRetry = vi.fn();

    await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      maxRetries: 2,
      fetchImpl,
      onRetry,
    }).catch(() => {});

    // 1 initial attempt + 2 retries = 3 calls; onRetry fires only between them.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('respects a custom maxRetries of 0 (no retries at all)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(503));

    await expect(
      fetchWithRetry('https://example.test', undefined, { fetchImpl, maxRetries: 0 }),
    ).rejects.toThrow(HttpError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('respects a custom isRetryableStatus', async () => {
    // Treat 429 as retryable for this call, overriding the 5xx-only default.
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(status(429));
    fetchImpl.mockResolvedValueOnce(ok());

    const response = await fetchWithRetry('https://example.test', undefined, {
      ...FAST,
      fetchImpl,
      isRetryableStatus: (s) => s === 429,
    });

    expect(response.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 429 by default', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => status(429));

    await expect(
      fetchWithRetry('https://example.test', undefined, { ...FAST, fetchImpl }),
    ).rejects.toThrow(HttpError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 429 when retryOn429 is set, waiting out Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const rateLimited = new Response(null, {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
      fetchImpl.mockResolvedValueOnce(rateLimited);
      fetchImpl.mockResolvedValueOnce(ok());

      const pending = fetchWithRetry('https://example.test', undefined, {
        baseDelayMs: 10,
        fetchImpl,
        retryOn429: true,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      const response = await pending;

      expect(response.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to exponential backoff when a 429 has no Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      fetchImpl.mockResolvedValueOnce(status(429));
      fetchImpl.mockResolvedValueOnce(ok());
      const onRetry = vi.fn();

      const pending = fetchWithRetry('https://example.test', undefined, {
        baseDelayMs: 100,
        fetchImpl,
        retryOn429: true,
        onRetry,
      });
      await vi.advanceTimersByTimeAsync(100);
      const response = await pending;

      expect(response.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry.mock.calls[0][2]).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws HttpError(429) after exhausting retries with retryOn429', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => status(429));

      const pending = fetchWithRetry('https://example.test', undefined, {
        baseDelayMs: 10,
        maxRetries: 2,
        fetchImpl,
        retryOn429: true,
      });
      const result = pending.catch((e: unknown) => e);
      // 2 retries: 10ms then 20ms backoff (no Retry-After header).
      for (let i = 0; i < 2; i++) await vi.advanceTimersByTimeAsync(10 * 2 ** i);
      const error = await result;

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(429);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses a Retry-After HTTP-date into milliseconds', () => {
    const later = new Date(Date.now() + 5_000).toUTCString();
    const ms = retryAfterMs(new Response(null, { headers: { 'Retry-After': later } }));
    expect(ms).toBeGreaterThanOrEqual(4_000);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it('returns undefined Retry-After when the header is absent', () => {
    expect(retryAfterMs(ok())).toBeUndefined();
  });
});

describe('HttpError', () => {
  it('carries the status and the original response', async () => {
    const response = status(503);
    const error = new HttpError(response);

    expect(error.status).toBe(503);
    expect(error.response).toBe(response);
    expect(error.message).toContain('503');
    expect(error.name).toBe('HttpError');
    expect(error).toBeInstanceOf(Error);
  });
});
