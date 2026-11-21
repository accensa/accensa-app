import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { encrypt, decrypt } from './auth';

const TEST_SECRET = 'test-secret-key-'.padEnd(40, 'x');
const OTHER_SECRET = 'other-secret-key-'.padEnd(40, 'y');

/** Build a compact `alg: none` token (unsigned). */
function algNoneToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('decrypt', () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET_KEY;
  });

  it('round-trips: a token produced by encrypt returns its claims', async () => {
    const token = await encrypt({ publicKey: 'GABC', role: 'admin' });
    const payload = await decrypt(token);
    expect(payload).toBeDefined();
    expect(payload?.publicKey).toBe('GABC');
    expect(payload?.role).toBe('admin');
  });

  it('resolves to undefined for an expired token', async () => {
    const token = await new SignJWT({ publicKey: 'GABC' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .sign(new TextEncoder().encode(TEST_SECRET));
    expect(await decrypt(token)).toBeUndefined();
  });

  it('resolves to undefined for a tampered token', async () => {
    const token = await encrypt({ publicKey: 'GABC' });
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await decrypt(tampered)).toBeUndefined();
  });

  it('resolves to undefined for a token signed with a foreign key', async () => {
    const token = await new SignJWT({ publicKey: 'GABC' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode(OTHER_SECRET));
    expect(await decrypt(token)).toBeUndefined();
  });

  it('resolves to undefined for an alg: none token', async () => {
    const token = algNoneToken({ publicKey: 'GABC', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(await decrypt(token)).toBeUndefined();
  });

  it('rejects (throws) when JWT_SECRET_KEY is unset', async () => {
    delete process.env.JWT_SECRET_KEY;
    const token = await new SignJWT({ publicKey: 'GABC' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode(TEST_SECRET));
    await expect(decrypt(token)).rejects.toThrow('JWT_SECRET_KEY is not set');
  });
});
