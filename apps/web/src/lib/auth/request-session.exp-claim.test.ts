import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { sessionFromRequest } from './request-session';

const TEST_SECRET = 'exp-claim-test-secret';
const KEY = new TextEncoder().encode(TEST_SECRET);

/** Mints a valid session token that includes exp (default) or omits it. */
async function mintToken(
  payload: Record<string, unknown>,
  options: { exp: boolean } = { exp: true },
): Promise<string> {
  let builder = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (options.exp) builder = builder.setExpirationTime('24h');
  return builder.sign(KEY);
}

function requestWithSession(token: string): Request {
  return new Request('http://localhost/api/test', {
    headers: { cookie: `accensa_session=${token}` },
  });
}

describe('sessionFromRequest — exp claim requirement', () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET_KEY;
  });

  it('rejects a correctly signed token that carries no exp claim', async () => {
    const token = await mintToken({ publicKey: 'GABC', role: 'admin' }, { exp: false });
    expect(await sessionFromRequest(requestWithSession(token))).toBeNull();
  });

  it('accepts a valid token with exp set in the future', async () => {
    const token = await mintToken({ publicKey: 'GABC', role: 'admin' });
    expect(await sessionFromRequest(requestWithSession(token))).toEqual({
      publicKey: 'GABC',
      role: 'admin',
    });
  });

  it('still rejects an expired token (exp in the past)', async () => {
    const token = await new SignJWT({ publicKey: 'GABC', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(KEY);
    expect(await sessionFromRequest(requestWithSession(token))).toBeNull();
  });

  it('still rejects a valid-expiry token that has no publicKey claim', async () => {
    const token = await mintToken({ role: 'admin' });
    expect(await sessionFromRequest(requestWithSession(token))).toBeNull();
  });
});
