/**
 * Server-Side Auth Verification (#141).
 *
 * Provides a verifyAuth method for the Accensa SDK that validates
 * authentication tokens on the server side. Useful for webhook handlers,
 * API middleware, and server-side rendering contexts.
 *
 * Usage:
 *   import { verifyAuth } from '@accensa/sdk/verify-auth';
 *
 *   // In your API route:
 *   const result = await verifyAuth(request, { secret: process.env.AUTH_SECRET });
 *   if (!result.valid) return new Response('Unauthorized', { status: 401 });
 */

export interface VerifyAuthOptions {
  /** The auth secret used to sign tokens. */
  secret: string;
  /** Expected issuer. */
  issuer?: string;
  /** Clock tolerance in seconds (default: 30). */
  clockTolerance?: number;
}

export interface VerifyAuthResult {
  valid: boolean;
  /** The decoded token payload if valid. */
  payload?: Record<string, unknown>;
  /** Error message if invalid. */
  error?: string;
  /** Token expiry timestamp if available. */
  expiresAt?: number;
}

/**
 * Verify an authentication token from an HTTP request.
 *
 * Extracts the token from the Authorization header (Bearer scheme)
 * and validates it using HMAC-SHA256.
 */
export async function verifyAuth(
  request: Request,
  options: VerifyAuthOptions,
): Promise<VerifyAuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { valid: false, error: 'No authorization header' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: 'Invalid authorization format' };
  }

  const token = parts[1];
  return verifyToken(token, options);
}

/**
 * Verify a JWT-like token using HMAC-SHA256.
 *
 * Format: base64url(header).base64url(payload).base64url(signature)
 */
export async function verifyToken(
  token: string,
  options: VerifyAuthOptions,
): Promise<VerifyAuthResult> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode payload
    const payloadJson = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Check expiry
    if (payload.exp && typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      const tolerance = options.clockTolerance ?? 30;
      if (now > payload.exp + tolerance) {
        return { valid: false, error: 'Token expired', expiresAt: payload.exp };
      }
    }

    // Check issuer
    if (options.issuer && payload.iss !== options.issuer) {
      return { valid: false, error: 'Invalid issuer' };
    }

    // Verify signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(options.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = Uint8Array.from(
      atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );

    const valid = await crypto.subtle.verify('HMAC', key, signature, data);

    if (!valid) {
      return { valid: false, error: 'Invalid signature' };
    }

    return {
      valid: true,
      payload,
      expiresAt: payload.exp as number | undefined,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Token verification failed',
    };
  }
}

/**
 * Extract merchant ID from a verified token.
 */
export function extractMerchantId(payload: Record<string, unknown>): string | null {
  return (payload.merchantId as string) ?? (payload.sub as string) ?? null;
}
