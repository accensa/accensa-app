import { logger } from '../log.ts';
import { DELIVERY_WINDOW_MS, MAX_ATTEMPTS, MAX_BACKOFF_MS } from './constants.ts';

export function shouldRetry(status: number | null, transportError: boolean): boolean {
  if (transportError) return true;
  if (status === null) return true;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  try {
    if (!header) return null;
    const trimmed = header.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      return now + Number(trimmed) * 1000;
    }
    const date = Date.parse(trimmed);
    if (Number.isNaN(date)) {
      logger.warn('Failed to parse Retry-After header', { header });
      return null;
    }
    return date;
  } catch (e) {
    logger.error('Unexpected error parsing Retry-After header', {
      header,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(1000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  return Math.floor(exp + random() * exp * 0.25);
}

export function nextRetryAt(opts: {
  attempt: number;
  createdAtMs: number;
  now: number;
  retryAfterHeader?: string | null;
  random?: () => number;
}): Date | null {
  try {
    if (opts.now - opts.createdAtMs >= DELIVERY_WINDOW_MS) return null;
    if (opts.attempt >= MAX_ATTEMPTS) return null;
    const fromHeader = parseRetryAfter(opts.retryAfterHeader, opts.now);
    const fromBackoff = opts.now + backoffMs(opts.attempt, opts.random ?? Math.random);
    const at = Math.max(fromHeader ?? 0, fromBackoff);
    if (at - opts.createdAtMs >= DELIVERY_WINDOW_MS) return null;
    return new Date(at);
  } catch (e) {
    logger.error('Failed to compute next retry at', {
      attempt: opts.attempt,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
