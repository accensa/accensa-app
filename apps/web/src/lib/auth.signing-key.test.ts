import { describe, it, expect, afterEach } from 'vitest';
import { encrypt } from './auth';

/** A one-byte key is brute-forceable offline from one captured cookie. */
describe('signingKey', () => {
  const original = process.env.JWT_SECRET_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET_KEY;
    else process.env.JWT_SECRET_KEY = original;
  });

  it('refuses a secret shorter than 32 bytes', async () => {
    process.env.JWT_SECRET_KEY = 'too-short';
    await expect(encrypt({ sub: 'x' })).rejects.toThrow(/at least 32 bytes/);
  });

  it('counts bytes rather than characters', async () => {
    // 16 two-byte characters are 32 bytes, so this one is accepted.
    process.env.JWT_SECRET_KEY = 'é'.repeat(16);
    await expect(encrypt({ sub: 'x' })).resolves.toEqual(expect.any(String));
    process.env.JWT_SECRET_KEY = 'é'.repeat(15);
    await expect(encrypt({ sub: 'x' })).rejects.toThrow(/at least 32 bytes/);
  });

  it('accepts a 32-byte secret', async () => {
    process.env.JWT_SECRET_KEY = 'a'.repeat(32);
    await expect(encrypt({ sub: 'x' })).resolves.toEqual(expect.any(String));
  });

  it('still refuses a missing secret', async () => {
    delete process.env.JWT_SECRET_KEY;
    await expect(encrypt({ sub: 'x' })).rejects.toThrow(/is not set/);
  });
});
