import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { sessionFromRequest } from './request-session';

const TEST_SECRET = 'cookie-precedence-test-secret';
const KEY = new TextEncoder().encode(TEST_SECRET);

async function mintValid(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(KEY);
}

async function mintExpired(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('-1s')
    .sign(KEY);
}

/** Builds a Request whose Cookie header carries multiple accensa_session= values. */
function requestWithCandidates(...sessionValues: string[]): Request {
  const cookieParts = ['other=1', ...sessionValues.map((v) => `accensa_session=${v}`)];
  return new Request('http://localhost/api/test', {
    headers: { cookie: cookieParts.join('; ') },
  });
}

describe('sessionFromRequest — cookie precedence', () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET_KEY;
  });

  it('skips the expired first cookie and returns the identity from the valid second one', async () => {
    const expired = await mintExpired({ publicKey: 'GEXPIRED', role: 'admin' });
    const valid = await mintValid({ publicKey: 'GVALID', role: 'viewer' });
    const result = await sessionFromRequest(requestWithCandidates(expired, valid));
    expect(result).toEqual({ publicKey: 'GVALID', role: 'viewer' });
  });

  it('returns the first verifiable identity when both cookies are valid', async () => {
    const first = await mintValid({ publicKey: 'GFIRST', role: 'admin' });
    const second = await mintValid({ publicKey: 'GSECOND', role: 'viewer' });
    const result = await sessionFromRequest(requestWithCandidates(first, second));
    expect(result).toEqual({ publicKey: 'GFIRST', role: 'admin' });
  });

  it('returns null when every candidate is invalid or malformed', async () => {
    const expired = await mintExpired({ publicKey: 'GEXPIRED', role: 'admin' });
    const result = await sessionFromRequest(requestWithCandidates('not-a-jwt', expired));
    expect(result).toBeNull();
  });

  it('skips a candidate with no publicKey and returns the next valid one', async () => {
    const noKey = await mintValid({ role: 'admin' });
    const valid = await mintValid({ publicKey: 'GVALID', role: 'viewer' });
    const result = await sessionFromRequest(requestWithCandidates(noKey, valid));
    expect(result).toEqual({ publicKey: 'GVALID', role: 'viewer' });
  });

  it('does not throw when a candidate contains a malformed URI escape sequence', async () => {
    // %E0%A4%A is an incomplete percent-sequence; decodeURIComponent throws URIError.
    // With the decoding inside the per-candidate try/catch it must yield null, not throw.
    const result = await sessionFromRequest(requestWithCandidates('%E0%A4%A'));
    expect(result).toBeNull();
  });
});
