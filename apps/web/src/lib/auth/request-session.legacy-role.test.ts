import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { sessionFromRequest } from './request-session';
import { roleFromRequest } from '@/lib/rbac';

const TEST_SECRET = 'legacy-role-test-secret';
const KEY = new TextEncoder().encode(TEST_SECRET);

/** Mints a session token. Omit `role` to simulate a legacy (pre-RBAC) session. */
async function mintCookie(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(KEY);
}

function requestWithCookie(cookie: string): Request {
  return new Request('http://localhost/api/auth/totp/generate', {
    method: 'POST',
    headers: { cookie: `accensa_session=${cookie}` },
  });
}

function requestWithRoleHeader(role: string | null): Request {
  return new Request('http://localhost/api/session', {
    headers: role ? { 'x-accensa-role': role } : {},
  });
}

describe('sessionFromRequest and roleFromRequest — role parity', () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET_KEY;
  });

  it.each([
    // [label, jwtRoleClaim, headerRole, expectedRole]
    ['legacy (no role claim)', undefined, null, 'admin'],
    ['explicit admin', 'admin', 'admin', 'admin'],
    ['explicit viewer', 'viewer', 'viewer', 'viewer'],
    ['unknown role "superuser"', 'superuser', 'superuser', 'admin'],
    ['null role claim', null, null, 'admin'],
  ] as const)(
    '%s: both helpers return "%s"',
    async (_label, jwtRole, headerRole, expectedRole) => {
      // Build JWT payload — omit role key entirely for the legacy case.
      const payload: Record<string, unknown> = { publicKey: 'GABC' };
      if (jwtRole !== undefined) payload.role = jwtRole;

      const cookie = await mintCookie(payload);
      const sessionResult = await sessionFromRequest(requestWithCookie(cookie));

      // sessionFromRequest resolves the role from the signed cookie.
      expect(sessionResult?.role).toBe(expectedRole);

      // roleFromRequest resolves the role from the proxy-set header.
      const headerResult = roleFromRequest(requestWithRoleHeader(headerRole));
      expect(headerResult).toBe(expectedRole);

      // Both helpers agree.
      expect(sessionResult?.role).toBe(headerResult);
    },
  );
});
