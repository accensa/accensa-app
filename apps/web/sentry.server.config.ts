import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_DSN,
  SENTRY_TRACES_SAMPLE_RATE,
  scrubStellarPii,
} from './src/lib/sentry-scrub';

Sentry.init({
  dsn: SENTRY_DSN,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  debug: false,
  // Scrub PII (like Stellar addresses which are pseudonymous but still user data)
  beforeSend(event: Sentry.ErrorEvent) {
    return scrubStellarPii(event);
  },
});
