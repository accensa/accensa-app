import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  // Scrub PII (like Stellar addresses which are pseudonymous but still user data)
  beforeSend(event: Sentry.ErrorEvent) {
    if (event.request && event.request.url) {
      // Redact potential Stellar addresses from URLs or inputs (G[A-Z2-7]{55})
      event.request.url = event.request.url.replace(/G[A-Z2-7]{55}/g, '[REDACTED-ADDRESS]');
    }

    // Also recursively scrub objects inside the event if needed
    // But Sentry already strips most PII. We'll add custom logic here if we log full addresses in breadcrumbs.
    if (event.breadcrumbs) {
      event.breadcrumbs.forEach((breadcrumb: Sentry.Breadcrumb) => {
        if (breadcrumb.message) {
          breadcrumb.message = breadcrumb.message.replace(/G[A-Z2-7]{55}/g, '[REDACTED-ADDRESS]');
        }
      });
    }

    return event;
  },
});
