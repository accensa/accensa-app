import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HTTP header that carries the Accensa webhook signature.
 *
 * The Accensa indexer signs every outbound webhook with HMAC-SHA256 and sends
 * the hex digest in this header (`x-webhook-signature` on the wire; HTTP
 * header names are case-insensitive). Merchants verify with
 * {@link verifyWebhookSignature}.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Computes the HMAC-SHA256 signature Accensa attaches to outbound webhooks.
 *
 * Signs the exact bytes that will be sent as the request body — same contract
 * as the settlement-report signing: whatever is signed is what must be sent.
 * The indexer computes `createHmac('sha256', secret).update(body).digest('hex')`,
 * and this function produces exactly that value, so a merchant that verifies
 * with this module accepts genuine indexer webhooks.
 *
 * @param payload The raw webhook body bytes. Pass the same string or Buffer
 *   that was POSTed — a re-serialised JSON object may differ in key order or
 *   whitespace and would fail verification.
 * @param secret The shared webhook secret, configured on both the Accensa
 *   deployment and the merchant server.
 * @returns Hex-encoded HMAC-SHA256 digest.
 */
export function signWebhookSignature(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifies an inbound webhook's `X-Webhook-Signature` header.
 *
 * Recomputes the HMAC-SHA256 digest over the received body and compares it
 * against the presented signature with a timing-safe comparison, so a failing
 * check does not leak how far the two digests agree. Returns false — never
 * throws — for a missing, malformed, or mismatched signature, which is what a
 * request handler wants to fail closed on.
 *
 * @param payload The raw body bytes exactly as received (see
 *   {@link signWebhookSignature} on why re-serialising is a footgun).
 * @param signature The value of the `X-Webhook-Signature` header, hex-encoded.
 * @param secret The shared webhook secret.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (typeof signature !== 'string' || signature.trim() === '') return false;

  let expected: Buffer;
  let received: Buffer;
  try {
    expected = Buffer.from(signWebhookSignature(payload, secret), 'hex');
    received = Buffer.from(signature.trim(), 'hex');
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch, so that is checked first — a
  // length difference is itself a failed verification.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
