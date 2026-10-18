import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

/**
 * Header name used for outbound webhook signatures.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Verify the HMAC-SHA256 signature of an incoming webhook request or body/signature pair.
 */
export function verifyWebhookSignature(
  bodyOrRequest: string | Buffer | Request,
  signatureOrSecret?: string | undefined | null,
  secretParam?: string
): boolean | Promise<boolean> {
  if (bodyOrRequest instanceof Request) {
    const request = bodyOrRequest;
    const secret = signatureOrSecret as string;
    const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
    
    // Async handling for Request objects
    return (async () => {
      if (!signature) return false;
      try {
        const body = await request.text();
        return verifySignatureInternal(body, signature, secret);
      } catch {
        return false;
      }
    })();
  }

  const body = bodyOrRequest;
  const signature = signatureOrSecret;
  const secret = secretParam;

  if (!signature || typeof signature !== 'string') return false;
  return verifySignatureInternal(body, signature, secret || '');
}

function verifySignatureInternal(body: string | Buffer, signature: string, secret: string): boolean {
  const trimmed = signature.trim();
  if (!trimmed || !/^[0-9a-f]{64}$/i.test(trimmed)) return false;

  try {
    const payloadBuffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const expected = createHmac('sha256', secret).update(payloadBuffer).digest('hex');

    const sigBuf = Buffer.from(trimmed, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length) return false;
    return cryptoTimingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Sign a webhook body with HMAC-SHA256.
 */
export function signWebhookSignature(body: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  const { randomBytes } = require('node:crypto');
  return randomBytes(32).toString('hex');
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
