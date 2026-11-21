import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify the HMAC-SHA256 signature that the Accensa indexer attaches to
 * outbound webhooks. Returns true when:
 *   - WEBHOOK_SECRET is configured and the signature matches the raw request
 *     bytes, OR
 *   - WEBHOOK_SECRET is not configured (permissive mode for local dev).
 *
 * rawBody must be the original request bytes, not a re-serialized JSON string.
 * Timing-safe comparison prevents side-channel leakage of the expected MAC.
 *
 * @param {Buffer|string} rawBody       — raw request bytes from req.rawBody
 * @param {string|undefined} signatureHeader — value of X-Webhook-Signature
 * @param {string|undefined} webhookSecret   — WEBHOOK_SECRET env var value
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) return true;
  if (!rawBody) return false;
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
