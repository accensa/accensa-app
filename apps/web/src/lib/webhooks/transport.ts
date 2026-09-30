import { logger } from '../log.ts';
import { signBody } from './signing.ts';

export interface DeliveryAttemptOutcome {
  statusCode: number | null;
  error: string | null;
  retryAfter: string | null;
  transportError: boolean;
}

/**
 * One signed HTTP attempt against the merchant's endpoint: Ed25519 signature
 * over the exact body bytes, hard abort at `timeoutMs` either way (the race
 * covers fetch implementations that ignore `signal`).
 *
 * Never throws — signing, transport, and timeout failures collapse into a
 * retryable outcome, exactly as the pre-#350 inline block did.
 */
export async function attemptDelivery(input: {
  id: string | number;
  url: string;
  body: string;
  signingKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<DeliveryAttemptOutcome> {
  let statusCode: number | null = null;
  let error: string | null = null;
  let retryAfter: string | null = null;
  let transportError = false;

  try {
    const signature = signBody(input.body, input.signingKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const fetchPromise: Promise<Response> = input.fetchImpl(input.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
          'X-Accensa-Timestamp': String(Math.floor(Date.now() / 1000)),
          'X-Accensa-Delivery-Id': String(input.id),
        },
        body: input.body,
        signal: controller.signal,
      });
      const res = await Promise.race<Response>([
        fetchPromise,
        new Promise((_resolve, reject) => {
          const id = setTimeout(() => {
            reject(Object.assign(new Error('webhook timeout'), { name: 'TimeoutError' }));
          }, input.timeoutMs);
          controller.signal.addEventListener('abort', () => {
            clearTimeout(id);
            reject(Object.assign(new Error('webhook timeout'), { name: 'TimeoutError' }));
          });
        }),
      ]);
      statusCode = res.status;
      retryAfter = res.headers.get('retry-after');
      if (!res.ok) error = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    transportError = true;
    error = e instanceof Error ? e.message : 'transport error';
    logger.warn('Webhook delivery attempt failed', { id: input.id, error, transportError: true });
  }

  return { statusCode, error, retryAfter, transportError };
}
