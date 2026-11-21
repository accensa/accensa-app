import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';
import { createSession } from './auth';

const TEST_SECRET = 'test-secret-key-'.padEnd(40, 'x');
const KEY = new TextEncoder().encode(TEST_SECRET);

/** Fake cookie store returned by the mocked `cookies()`. Hoisted so the factory can reference them. */
const { mockSet, mockDelete } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: mockSet, delete: mockDelete }),
}));

describe('createSession — cookie flags', () => {
  const FROZEN_NOW = new Date('2026-06-01T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
    process.env.JWT_SECRET_KEY = TEST_SECRET;
    mockSet.mockClear();
    mockDelete.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('sets httpOnly, sameSite: lax, path: / on every call', async () => {
    await createSession('GPUBKEY', 'admin');
    expect(mockSet).toHaveBeenCalledOnce();
    const [name, , opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe('accensa_session');
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
  });

  it('sets secure: true in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await createSession('GPUBKEY', 'admin');
    const [, , opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(opts.secure).toBe(true);
  });

  it('sets secure: false in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await createSession('GPUBKEY', 'admin');
    const [, , opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(opts.secure).toBe(false);
  });

  it('expires exactly 24 hours from the frozen clock', async () => {
    await createSession('GPUBKEY', 'admin');
    const [, , opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    const expectedExpires = new Date(FROZEN_NOW + 24 * 60 * 60 * 1000);
    expect((opts.expires as Date).getTime()).toBe(expectedExpires.getTime());
  });

  it('the signed payload exp - iat === 86400 and matches the cookie expires', async () => {
    await createSession('GPUBKEY', 'admin');
    const [, token, opts] = mockSet.mock.calls[0] as [string, string, Record<string, unknown>];
    const { payload } = await jwtVerify(token, KEY, { algorithms: ['HS256'] });
    expect(payload.exp! - payload.iat!).toBe(86400);
    // The expires claim in the payload should equal the cookie's expires.
    expect(payload.expires).toBe((opts.expires as Date).toISOString());
  });

  it('embeds publicKey and role in the signed token', async () => {
    await createSession('GVIEWER', 'viewer');
    const [, token] = mockSet.mock.calls[0] as [string, string];
    const { payload } = await jwtVerify(token, KEY, { algorithms: ['HS256'] });
    expect(payload.publicKey).toBe('GVIEWER');
    expect(payload.role).toBe('viewer');
  });
});
