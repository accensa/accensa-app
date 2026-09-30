import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Short-lived signed tokens proving a 2FA challenge was just satisfied (#411).
 *
 * A merchant enables 2FA, then every sensitive settings mutation — treasury
 * payout address, API key generation/revocation, refund thresholds — must
 * present a fresh TOTP code or backup code. Passing that proof from the
 * challenge endpoint to the mutation endpoint as a short-lived HMAC-signed
 * token keeps the mutation routes stateless: no second table, no server-side
 * session rewrite, and no window where "verified at some point today" is
 * enough (the token expires in two minutes and is single-purpose by audience
 * tag).
 *
 * The signing key is derived (domain-separated) from the deployment's existing
 * `JWT_SECRET_KEY`, exactly like the TOTP secret encryption key in
 * `lib/auth/totp.ts` — no new environment variable.
 */

/** How long a satisfied challenge may be presented to a mutation route. */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

function challengeKey(): Buffer {
  const secretKey = process.env.JWT_SECRET_KEY;
  if (!secretKey) {
    throw new Error('JWT_SECRET_KEY is not set; refusing to mint a 2FA challenge token');
  }
  return createHash('sha256').update(`accensa:totp-challenge:${secretKey}`, 'utf8').digest();
}

export interface ChallengeTokenPayload {
  /** The merchant the challenge was satisfied for. */
  merchantId: number;
  /** Absolute epoch ms expiry. */
  exp: number;
  /** Random nonce so two challenges in the same ms are still distinct. */
  jti: string;
}

/** Mints a signed 2FA challenge proof for `merchantId`. */
export function mintChallengeToken(merchantId: number, now: number = Date.now()): string {
  const payload: ChallengeTokenPayload = {
    merchantId,
    exp: now + CHALLENGE_TTL_MS,
    jti: randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', challengeKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export type ChallengeTokenResult =
  | { ok: true; merchantId: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_merchant' };

/**
 * Verifies a challenge token for a given merchant.
 *
 * `merchantId` must match the token's subject: a proof satisfied for one
 * tenant can never be replayed against another's mutation endpoint.
 */
export function verifyChallengeToken(
  token: string,
  merchantId: number,
  now: number = Date.now(),
): ChallengeTokenResult {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;

  const expected = createHmac('sha256', challengeKey()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: ChallengeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof payload.merchantId !== 'number' ||
    typeof payload.exp !== 'number' ||
    typeof payload.jti !== 'string'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp < now) return { ok: false, reason: 'expired' };
  if (payload.merchantId !== merchantId) return { ok: false, reason: 'wrong_merchant' };

  return { ok: true, merchantId: payload.merchantId };
}

/**
 * Extracts and validates the `x-accensa-2fa` header on a mutation request.
 *
 * Returns false when the caller has not satisfied a 2FA challenge recently —
 * the mutation route then answers 403. Routes call this *after* the ordinary
 * session/merchant checks, so the header only ever complements them.
 */
export function twoFactorFromRequest(request: Request, merchantId: number): boolean {
  const token = request.headers.get('x-accensa-2fa');
  if (!token) return false;
  return verifyChallengeToken(token, merchantId).ok;
}
