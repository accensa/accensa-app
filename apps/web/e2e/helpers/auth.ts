import { SignJWT } from 'jose';

/**
 * The JWT_SECRET_KEY the web server signs sessions with. Must match the env
 * passed to the Playwright webServer (see playwright.e2e.config.ts).
 */
const E2E_JWT_SECRET = 'playwright-e2e-secret-key';

const signingKey = new TextEncoder().encode(E2E_JWT_SECRET);

/**
 * Mints a valid `accensa_session` cookie exactly the way
 * `apps/web/src/lib/auth.ts` does (HS256, `{ publicKey, expires }`, 24h).
 * The dashboard middleware verifies this cookie, so specs can visit
 * authenticated routes without driving the Freighter sign-in flow.
 */
export async function mintSessionCookie(publicKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'): Promise<string> {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ publicKey, expires: expires.toISOString() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(signingKey);
  return `accensa_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}