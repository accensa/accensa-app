import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alertCspViolation } from './alerting';
import type { CspViolation } from './csp-report';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({ captureMessage }));

const WEBHOOK_URL = 'https://hooks.example.test/security-alerts';

const report: CspViolation = {
  documentUri: 'https://shop.example/checkout',
  violatedDirective: 'script-src-elem',
  effectiveDirective: 'script-src-elem',
  blockedUri: 'https://evil.example/injected.js',
  sourceFile: 'https://shop.example/app.js',
  lineNumber: 12,
  statusCode: null,
};

function stubFetch(implementation: typeof fetch = vi.fn().mockResolvedValue(new Response(null))) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function loggedEntry(consoleError: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const [message] = consoleError.mock.calls[0] as [string];
  return JSON.parse(message) as Record<string, unknown>;
}

function webhookRequest(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('alertCspViolation', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.SECURITY_ALERT_WEBHOOK_URL;
    captureMessage.mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.SECURITY_ALERT_WEBHOOK_URL;
  });

  it('logs a structured JSON entry containing the violation and a timestamp', async () => {
    await alertCspViolation(report);

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = loggedEntry(consoleError);
    expect(entry).toMatchObject({ level: 'error', event: 'csp_violation', ...report });
    expect(typeof entry.reportedAt).toBe('string');
    expect(new Date(entry.reportedAt as string).toISOString()).toBe(entry.reportedAt);
  });

  it('captures a high-severity message in Sentry with the report as extra context', async () => {
    await alertCspViolation(report);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('High-severity Content Security Policy violation', {
      level: 'error',
      extra: { ...report },
    });
  });

  it('does not perform an HTTP request when no webhook URL is configured', async () => {
    const fetchMock = stubFetch();

    await alertCspViolation(report);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the incident notification to the configured webhook', async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = stubFetch();

    await alertCspViolation(report);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, body } = webhookRequest(fetchMock);
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body.content).toBe(
      'High-severity CSP violation: script-src-elem blocked https://evil.example/injected.js',
    );
    expect(body.text).toBe(body.content);
  });

  it('describes a violation without a blocked URI as an unknown source', async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = stubFetch();

    await alertCspViolation({ ...report, blockedUri: '' });

    const { body } = webhookRequest(fetchMock);
    expect(body.content).toBe(
      'High-severity CSP violation: script-src-elem blocked an unknown source',
    );
    expect(body.text).toBe(body.content);
  });

  it('aborts the webhook request after the two second timeout without throwing', async () => {
    vi.useFakeTimers();
    process.env.SECURITY_ALERT_WEBHOOK_URL = WEBHOOK_URL;
    let requestSignal: AbortSignal | undefined;
    stubFetch(
      ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })) as typeof fetch,
    );

    const pending = alertCspViolation(report);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBeUndefined();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('swallows webhook delivery failures so callers are unaffected', async () => {
    process.env.SECURITY_ALERT_WEBHOOK_URL = WEBHOOK_URL;
    stubFetch((() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch);

    await expect(alertCspViolation(report)).resolves.toBeUndefined();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
