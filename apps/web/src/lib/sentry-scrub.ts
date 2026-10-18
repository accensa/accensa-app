/**
 * Sentry PII scrubber and common configuration.
 *
 * Environment variables:
 * - NEXT_PUBLIC_SENTRY_DSN: The Sentry DSN (read literally so Next.js client bundles inline it).
 * - SENTRY_TRACES_SAMPLE_RATE: Optional traces sample rate between 0.0 and 1.0 (defaults to 1.0).
 *
 * Scrubber decision:
 * We mutate the event in place and return it, matching Sentry's beforeSend contract
 * and avoiding unnecessary object allocations across runtime environments.
 */

import type { ErrorEvent } from '@sentry/nextjs';

/**
 * Stellar address pattern: capital G followed by 55 characters from [A-Z2-7].
 * Defined once for the entire Sentry telemetry pipeline.
 */
export const STELLAR_ADDRESS_PATTERN = /G[A-Z2-7]{55}/g;

/**
 * Exact replacement marker matching existing monitoring and alert rules.
 */
export const REDACTED_ADDRESS_MARKER = '[REDACTED-ADDRESS]';

/**
 * Reads the Next.js public Sentry DSN literally so the client bundler inlines it.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Resolves the traces sample rate, defaulting to 1.0.
 * If SENTRY_TRACES_SAMPLE_RATE is set, validates it into [0, 1].
 */
function getTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return 1.0;
}

export const SENTRY_TRACES_SAMPLE_RATE = getTracesSampleRate();

/**
 * Deep-walks an object or array to scrub Stellar addresses from string values.
 * Protected against circular references and bounded by a maximum recursion depth.
 */
function scrubData(
  data: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
  maxDepth = 6,
): unknown {
  if (depth > maxDepth || data === null || typeof data !== 'object') {
    if (typeof data === 'string') {
      return data.replace(STELLAR_ADDRESS_PATTERN, REDACTED_ADDRESS_MARKER);
    }
    return data;
  }

  if (seen.has(data)) {
    return data;
  }
  seen.add(data);

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      if (typeof val === 'string') {
        data[i] = val.replace(STELLAR_ADDRESS_PATTERN, REDACTED_ADDRESS_MARKER);
      } else if (val !== null && typeof val === 'object') {
        scrubData(val, seen, depth + 1, maxDepth);
      }
    }
    return data;
  }

  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    try {
      const val = record[key];
      if (typeof val === 'string') {
        record[key] = val.replace(STELLAR_ADDRESS_PATTERN, REDACTED_ADDRESS_MARKER);
      } else if (val !== null && typeof val === 'object') {
        scrubData(val, seen, depth + 1, maxDepth);
      }
    } catch {
      // Ignore property getter errors or non-configurable properties
    }
  }

  return data;
}

/**
 * Scrubs potential Stellar public addresses from Sentry error events.
 * Operates on request URL, event message, exception values, and breadcrumbs.
 * Always returns the event (never drops it and never returns null).
 */
export function scrubStellarPii(event: ErrorEvent): ErrorEvent {
  if (!event || typeof event !== 'object') {
    return event;
  }

  try {
    // 1. Scrub request URL
    if (event.request && typeof event.request.url === 'string') {
      event.request.url = event.request.url.replace(
        STELLAR_ADDRESS_PATTERN,
        REDACTED_ADDRESS_MARKER,
      );
    }

    // 2. Scrub event message
    if (typeof event.message === 'string') {
      event.message = event.message.replace(
        STELLAR_ADDRESS_PATTERN,
        REDACTED_ADDRESS_MARKER,
      );
    } else if (
      event.message &&
      typeof (event.message as { message?: unknown }).message === 'string'
    ) {
      (event.message as { message: string }).message = (
        event.message as { message: string }
      ).message.replace(STELLAR_ADDRESS_PATTERN, REDACTED_ADDRESS_MARKER);
    }

    // 3. Scrub exception values
    if (event.exception && Array.isArray(event.exception.values)) {
      for (const val of event.exception.values) {
        if (val && typeof val.value === 'string') {
          val.value = val.value.replace(
            STELLAR_ADDRESS_PATTERN,
            REDACTED_ADDRESS_MARKER,
          );
        }
      }
    }

    // 4. Scrub breadcrumbs (messages and nested data)
    if (Array.isArray(event.breadcrumbs)) {
      for (const breadcrumb of event.breadcrumbs) {
        if (!breadcrumb || typeof breadcrumb !== 'object') continue;

        if (typeof breadcrumb.message === 'string') {
          breadcrumb.message = breadcrumb.message.replace(
            STELLAR_ADDRESS_PATTERN,
            REDACTED_ADDRESS_MARKER,
          );
        }

        if (breadcrumb.data && typeof breadcrumb.data === 'object') {
          scrubData(breadcrumb.data);
        }
      }
    }
  } catch {
    // Never throw or drop the event on unexpected shapes
  }

  return event;
}
