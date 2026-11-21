import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from '@/lib/auth';
import { POST } from './route';

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));

const MERCHANT = 'G' + 'A'.repeat(55);
const OTHER = 'G' + 'B'.repeat(55);

function request(merchantHeader?: string) {
  return new Request('http://localhost/api/auth/renew', {
    method: 'POST',
    headers: merchantHeader ? { 'x-accensa-merchant': merchantHeader } : {},
  });
}

async function tokenFor(publicKey: string, role?: string) {
  return encrypt({ publicKey, ...(role === undefined ? {} : { role }) });
}

async function renewedSession(): Promise<Record<string, unknown> | undefined> {
  expect(cookieStore.set).toHaveBeenCalledTimes(1);
  const [name, value] = cookieStore.set.mock.calls[0];
  expect(name).toBe('accensa_session');
  return decrypt(String(value));
}

describe('/api/auth/renew POST', () => {
  const originalSecret = process.env.JWT_SECRET_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET_KEY = 'test-secret-key-for-renew-route-32';
    cookieStore.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET_KEY;
    else process.env.JWT_SECRET_KEY = originalSecret;
  });

  it('renews a viewer session as a viewer in Set-Cookie', async () => {
    cookieStore.get.mockReturnValue({ value: await tokenFor(MERCHANT, 'viewer') });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await renewedSession()).toMatchObject({ publicKey: MERCHANT, role: 'viewer' });
  });

  it('keeps an admin session admin', async () => {
    cookieStore.get.mockReturnValue({ value: await tokenFor(MERCHANT, 'admin') });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await renewedSession()).toMatchObject({ publicKey: MERCHANT, role: 'admin' });
  });

  it('treats a legacy session without a role as the least privileged role', async () => {
    cookieStore.get.mockReturnValue({ value: await tokenFor(MERCHANT) });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await renewedSession()).toMatchObject({ publicKey: MERCHANT, role: 'viewer' });
  });

  it('rejects a request with no cookie and sets none', async () => {
    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('rejects an invalid cookie and sets none', async () => {
    cookieStore.get.mockReturnValue({ value: 'not-a-valid-jwt' });

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('ignores an x-accensa-merchant header that names another merchant', async () => {
    cookieStore.get.mockReturnValue({ value: await tokenFor(MERCHANT, 'viewer') });

    const res = await POST(request(OTHER));

    expect(res.status).toBe(200);
    expect(await renewedSession()).toMatchObject({ publicKey: MERCHANT, role: 'viewer' });
  });
});
