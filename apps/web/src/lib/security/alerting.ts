import * as Sentry from '@sentry/nextjs';
import type { CspViolation } from './csp-report';

export async function alertCspViolation(report: CspViolation): Promise<void> {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'csp_violation',
      ...report,
      reportedAt: new Date().toISOString(),
    }),
  );

  Sentry.captureMessage('High-severity Content Security Policy violation', {
    level: 'error',
    extra: { ...report },
  });

  const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `High-severity CSP violation: ${report.effectiveDirective} blocked ${report.blockedUri || 'an unknown source'}`,
        text: `High-severity CSP violation: ${report.effectiveDirective} blocked ${report.blockedUri || 'an unknown source'}`,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Alert delivery must not change the response to the browser.
  }
}
