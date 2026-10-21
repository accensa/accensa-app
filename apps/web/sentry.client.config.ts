import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE, scrubStellarPii } from './src/lib/sentry-scrub';

const COMMON_SENTRY_CONFIG = {
  dsn: SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Scrub PII (like Stellar addresses which are pseudonymous but still user data)
  beforeSend(event: Sentry.ErrorEvent) {
    return scrubStellarPii(event);
  },
};

Sentry.init(COMMON_SENTRY_CONFIG);
