import { createHmac, randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

/**
 * Header name used for outbound webhook signatures.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Header carrying the Unix seconds at sign time. When present, the signature
 * binds `t=<seconds>.<body>` and is only accepted inside the tolerance window.
 */
export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';

/**
 * Default replay window for timestamped webhooks, in seconds. Older payloads
 * are rejected; timestamps ahead of the verifier's clock are always rejected.
 */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookTimestamp = string | number;

export interface WebhookVerificationOptions {
  /** Unix seconds; overrides the timestamp header carried by a Request. */
  timestamp?: WebhookTimestamp | null;
  /** Maximum acceptable age in seconds. Defaults to 300. */
  tolerance?: number;
}

/**
 * Consumer wiring reference for outbound webhooks delivery.
 */
export function verifyOutboundWebhookDelivery(
  body: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  return verifyWebhookSignature(body, signature, secret) as boolean;
}

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook request or body/signature pair.
 *
 * A timestamp may be supplied via the options argument (or the shorthand fourth
 * argument) or is read from `x-webhook-timestamp` on a Request. When no timestamp
 * is present the original bare-body signature is verified, so existing senders
 * keep working; when one is present the signature must cover the timestamp too.
 */
export function verifyWebhookSignature(
  bodyOrRequest: string | Buffer | Request,
  secretOrSignature?: string | null | undefined,
  optionsOrSecret?: WebhookVerificationOptions | WebhookTimestamp | string | null | number,
  toleranceOrOptions?: number | WebhookVerificationOptions | null | undefined,
  toleranceSeconds?: number,
): boolean | Promise<boolean> {
  if (bodyOrRequest instanceof Request) {
    const request = bodyOrRequest;
    const secret = secretOrSignature as string | undefined;
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      return Promise.resolve(false);
    }
    const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
    const options = normalizeOptions(
      optionsOrSecret as WebhookVerificationOptions | WebhookTimestamp | null | undefined,
      typeof toleranceOrOptions === 'number' ? toleranceOrOptions : undefined,
    );
    const timestamp = options.timestamp ?? request.headers.get(WEBHOOK_TIMESTAMP_HEADER);
    const tolerance = options.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;

    return (async () => {
      if (!signature) return false;
      try {
        const body = await request.text();
        return verifySignatureInternal(body, signature, secret, timestamp, tolerance);
      } catch {
        return false;
      }
    })();
  }

  const body = bodyOrRequest;
  const signature = secretOrSignature as string | undefined;
  const secret = optionsOrSecret as string | undefined;
  const options = normalizeOptions(
    toleranceOrOptions as WebhookVerificationOptions | WebhookTimestamp | null | undefined,
    toleranceSeconds,
  );

  if (!signature || typeof signature !== 'string' || signature.trim() === '') return false;
  if (!secret || typeof secret !== 'string' || secret.trim() === '') return false;
  return verifySignatureInternal(
    body,
    signature,
    secret,
    options.timestamp,
    options.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  );
}

function normalizeOptions(
  optionsOrTimestamp?: WebhookVerificationOptions | WebhookTimestamp | null,
  toleranceSeconds?: number,
): WebhookVerificationOptions {
  if (typeof optionsOrTimestamp === 'object' && optionsOrTimestamp !== null) {
    return {
      ...optionsOrTimestamp,
      tolerance: optionsOrTimestamp.tolerance ?? toleranceSeconds,
    };
  }
  return { timestamp: optionsOrTimestamp ?? undefined, tolerance: toleranceSeconds };
}

function secondsOf(value: WebhookTimestamp): number | null {
  const numeric = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // Accept the documented Unix-seconds value and the millisecond form some
  // senders use; both are reduced to whole seconds before binding/skew checks.
  const seconds = numeric >= 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function timestampedBody(
  body: string | Buffer,
  seconds: number,
  withPrefix: boolean,
): string | Buffer {
  const prefix = `${withPrefix ? 't=' : ''}${seconds}.`;
  if (typeof body === 'string') return `${prefix}${body}`;
  return Buffer.concat([Buffer.from(prefix, 'utf8'), body]);
}

function matchesSignature(
  body: string | Buffer,
  signature: string,
  secret: string,
  candidates: (string | Buffer)[],
): boolean {
  const trimmed = signature.trim();
  if (!trimmed || !/^[0-9a-f]{64}$/i.test(trimmed)) return false;

  const sigBuf = Buffer.from(trimmed, 'hex');
  return candidates.some((payload) => {
    const expected = Buffer.from(createHmac('sha256', secret).update(payload).digest('hex'), 'hex');
    if (expected.length !== sigBuf.length) return false;
    return cryptoTimingSafeEqual(expected, sigBuf);
  });
}

function verifySignatureInternal(
  body: string | Buffer,
  signature: string,
  secret: string,
  timestamp: WebhookTimestamp | null | undefined,
  tolerance: number,
): boolean {
  if (!Number.isFinite(tolerance) || tolerance < 0) return false;

  if (timestamp === undefined || timestamp === null) {
    // Backward compatibility: an unversioned sender signs the raw body only.
    return matchesSignature(body, signature, secret, [body]);
  }

  const seconds = secondsOf(timestamp);
  if (seconds === null) return false;

  const age = Math.floor(Date.now() / 1000) - seconds;
  if (age < 0 || age > tolerance) return false;

  // `t=<seconds>.<body>` is canonical; the unprefixed `<seconds>.<body>` form
  // is accepted as well so older timestamped senders remain verifiable.
  return matchesSignature(body, signature, secret, [
    timestampedBody(body, seconds, true),
    timestampedBody(body, seconds, false),
  ]);
}

/**
 * Sign a webhook body with HMAC-SHA256. Passing a timestamp binds the
 * signature to `t=<seconds>.<body>` for replay-protected delivery.
 */
export function signWebhookSignature(
  body: string | Buffer,
  secret: string,
  timestamp?: WebhookTimestamp | null,
): string {
  if (timestamp === undefined || timestamp === null) {
    return createHmac('sha256', secret).update(body).digest('hex');
  }
  const seconds = secondsOf(timestamp);
  if (seconds === null) throw new Error('Invalid webhook timestamp');
  return createHmac('sha256', secret)
    .update(timestampedBody(body, seconds, true))
    .digest('hex');
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
