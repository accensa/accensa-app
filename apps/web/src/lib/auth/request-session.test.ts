import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { sessionFromRequest } from './request-session';

const TEST_SECRET = 'request-session-test-secret';

async function mintCookie(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(secret));
}

const requestWithCookie = (cookie: string | null, extraCookies = '') =>
  new Request('http://localhost/api/auth/totp/generate', {
    method: 'POST',
    headers: cookie
      ? { cookie: `other=1; accensa_session=${cookie}${extraCookies ? `; ${extraCookies}` : ''}` }
      : {},
  });

describe('sessionFromRequest', () => {
  const originalSecret = process.env.JWT_SECRET_KEY;

  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET_KEY;
    else process.env.JWT_SECRET_KEY = originalSecret;
  });

  it('returns null when there is no cookie header', async () => {
    expect(await sessionFromRequest(requestWithCookie(null))).toBeNull();
  });

  it('returns null when the accensa_session cookie is empty', async () => {
    expect(await sessionFromRequest(requestWithCookie(''))).toBeNull();
  });

  it('returns null for a cookie signed under a different key', async () => {
    const cookie = await mintCookie({ publicKey: 'GABC', role: 'admin' }, 'wrong-secret');
    expect(await sessionFromRequest(requestWithCookie(cookie))).toBeNull();
  });

  it('returns null for a tampered token', async () => {
    const cookie = await mintCookie({ publicKey: 'GABC', role: 'admin' });
    const tampered = `${cookie.slice(0, -4)}AAAA`;
    expect(await sessionFromRequest(requestWithCookie(tampered))).toBeNull();
  });

  it('returns null when the payload has no publicKey claim', async () => {
    const cookie = await mintCookie({ role: 'admin' });
    expect(await sessionFromRequest(requestWithCookie(cookie))).toBeNull();
  });

  it('extracts the session among other cookies', async () => {
    const cookie = await mintCookie({ publicKey: 'GABC', role: 'viewer' });
    expect(await sessionFromRequest(requestWithCookie(cookie, 'other=2'))).toEqual({
      publicKey: 'GABC',
      role: 'viewer',
    });
  });

  it('defaults a missing role claim to admin (legacy sessions)', async () => {
    const cookie = await mintCookie({ publicKey: 'GABC' });
    expect(await sessionFromRequest(requestWithCookie(cookie))).toEqual({
      publicKey: 'GABC',
      role: 'admin',
    });
  });

  it('defaults an unknown role claim to admin rather than trusting it', async () => {
    const cookie = await mintCookie({ publicKey: 'GABC', role: 'superuser' });
    expect(await sessionFromRequest(requestWithCookie(cookie))).toEqual({
      publicKey: 'GABC',
      role: 'admin',
    });
  });

  it('throws loudly when JWT_SECRET_KEY is unset instead of skipping verification', async () => {
    delete process.env.JWT_SECRET_KEY;
    const cookie = await mintCookie({ publicKey: 'GABC', role: 'admin' });
    await expect(sessionFromRequest(requestWithCookie(cookie))).rejects.toThrow(
      /JWT_SECRET_KEY is not set/,
    );
  });
});
