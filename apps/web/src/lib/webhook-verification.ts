/**
 * SDK Webhook Verification Integration (#149).
 *
 * Provides webhook signature verification for the Demo-merchant integration.
 * Validates that incoming webhook requests are authentic and haven't been
 * tampered with, using HMAC-SHA256 signatures.
 *
 * Usage:
 *   import { verifyWebhookSignature, WEBHOOK_SECRET_HEADER } from '@/lib/webhook-verification';
 *
 *   // In your webhook route handler:
 *   const isValid = verifyWebhookSignature(request, webhookSecret);
 *   if (!isValid) return new Response('Invalid signature', { status: 401 });
 */

export const WEBHOOK_SIGNATURE_HEADER = 'x-accensa-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-accensa-timestamp';
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook request.
 *
 * Signature format: `t=<timestamp>,v1=<signature>`
 * The signature is computed over: `${timestamp}.${body}`
 *
 * @param request   The incoming HTTP request
 * @param secret    The webhook signing secret
 * @returns         true if the signature is valid
 */
export async function verifyWebhookSignature(request: Request, secret: string): Promise<boolean> {
  try {
    const signatureHeader = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
    if (!signatureHeader) return false;

    // Parse signature components
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((part) => {
        const [key, ...value] = part.split('=');
        return [key, value.join('=')];
      }),
    );

    const timestamp = parts.t;
    const signature = parts.v1;

    if (!timestamp || !signature) return false;

    // Check timestamp freshness
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const age = Math.abs(Date.now() - timestampMs);
    if (age > TIMESTAMP_TOLERANCE_MS) {
      return false;
    }

    // Read the request body
    const body = await request.text();

    // Compute expected signature
    const payload = `${timestamp}.${body}`;
    const expectedSignature = await computeHMAC(payload, secret);

    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(signature, expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Compute HMAC-SHA256 signature.
 */
async function computeHMAC(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
