import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, createHash } from 'crypto';
import { mintChallengeToken, verifyChallengeToken, CHALLENGE_TTL_MS } from './totp-challenge';

function challengeKey(): Buffer {
  const secretKey = process.env.JWT_SECRET_KEY;
  if (!secretKey) {
    throw new Error('JWT_SECRET_KEY is not set');
  }
  return createHash('sha256').update(`accensa:totp-challenge:${secretKey}`, 'utf8').digest();
}

describe('totp-challenge', () => {
  const originalEnv = process.env.JWT_SECRET_KEY;

  beforeEach(() => {
    process.env.JWT_SECRET_KEY = 'test-jwt-secret-key-for-challenge';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.JWT_SECRET_KEY = originalEnv;
    } else {
      delete process.env.JWT_SECRET_KEY;
    }
  });

  it('mints and verifies a valid token successfully (round-trip)', () => {
    const merchantId = 101;
    const now = 1000000;
    const token = mintChallengeToken(merchantId, now);

    const result = verifyChallengeToken(token, merchantId, now + 1000);
    expect(result).toEqual({ ok: true, merchantId });
  });

  it('returns malformed for tokens with invalid structure', () => {
    const merchantId = 101;
    const now = 1000000;

    expect(verifyChallengeToken('not-a-valid-token', merchantId, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyChallengeToken('part1.part2.part3', merchantId, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('returns malformed when payload is not valid JSON and signature matches', () => {
    const merchantId = 101;
    const now = 1000000;
    const invalidBody = Buffer.from('not-json').toString('base64url');
    const sig = createHmac('sha256', challengeKey()).update(invalidBody).digest('base64url');
    const crafted = `${invalidBody}.${sig}`;
    const res = verifyChallengeToken(crafted, merchantId, now);
    expect(res.ok).toBe(false);
  });

  it('returns malformed when payload schema fields are incorrect and signature matches', () => {
    const merchantId = 101;
    const now = 1000000;
    const invalidPayload = JSON.stringify({ merchantId: '101', exp: now + 1000, jti: 'abc' });
    const body = Buffer.from(invalidPayload).toString('base64url');
    const sig = createHmac('sha256', challengeKey()).update(body).digest('base64url');
    const crafted2 = `${body}.${sig}`;
    expect(verifyChallengeToken(crafted2, merchantId, now)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('returns wrong_merchant when payload is valid JSON and signature matches but merchantId is wrong', () => {
    const merchantId = 101;
    const now = 1000000;
    const invalidPayload = JSON.stringify({ merchantId: 999, exp: now + 1000, jti: 'abc' });
    const body = Buffer.from(invalidPayload).toString('base64url');
    const sig = createHmac('sha256', challengeKey()).update(body).digest('base64url');
    const crafted2 = `${body}.${sig}`;
    expect(verifyChallengeToken(crafted2, merchantId, now)).toEqual({
      ok: false,
      reason: 'wrong_merchant',
    });
  });

  it('returns bad_signature when signature is signed with a different key', () => {
    const merchantId = 101;
    const now = 1000000;
    const token = mintChallengeToken(merchantId, now);

    process.env.JWT_SECRET_KEY = 'different-secret-key';

    expect(verifyChallengeToken(token, merchantId, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('returns bad_signature when signature byte is flipped or length differs', () => {
    const merchantId = 101;
    const now = 1000000;
    const token = mintChallengeToken(merchantId, now);
    const [body, sig] = token.split('.');

    const shortSigToken = `${body}.${sig.slice(0, 5)}`;
    expect(verifyChallengeToken(shortSigToken, merchantId, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });

    const sigChars = sig.split('');
    sigChars[0] = sigChars[0] === 'a' ? 'b' : 'a';
    const tamperedToken = `${body}.${sigChars.join('')}`;
    expect(verifyChallengeToken(tamperedToken, merchantId, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('returns expired when token expiration is in the past', () => {
    const merchantId = 101;
    const now = 1000000;
    const token = mintChallengeToken(merchantId, now);

    const futureNow = now + CHALLENGE_TTL_MS + 1;
    expect(verifyChallengeToken(token, merchantId, futureNow)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('returns wrong_merchant when verified against a different merchantId', () => {
    const merchantId = 101;
    const now = 1000000;
    const token = mintChallengeToken(merchantId, now);

    expect(verifyChallengeToken(token, 999, now)).toEqual({
      ok: false,
      reason: 'wrong_merchant',
    });
  });
});
