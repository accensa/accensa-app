import { SignJWT } from 'jose';

/**
 * The JWT_SECRET_KEY the web server signs sessions with. Playwright injects
 * this per config: playwright.e2e.config.ts and its workflow pass
 * `playwright-e2e-secret-key`, while playwright.config.ts (visual regression)
 * passes `visual-regression-test-secret`. Preferring the env var keeps the
 * helper consistent with whichever config launched the run.
 */
const E2E_JWT_SECRET = process.env.JWT_SECRET_KEY ?? 'playwright-e2e-secret-key';

const signingKey = new TextEncoder().encode(E2E_JWT_SECRET);

/**
 * Mints a valid `accensa_session` cookie exactly the way
 * `apps/web/src/lib/auth.ts` does (HS256, `{ publicKey, expires }`, 24h).
 * The dashboard middleware verifies this cookie, so specs can visit
 * authenticated routes without driving the Freighter sign-in flow.
 */
export async function mintSessionCookie(
  publicKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
): Promise<string> {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ publicKey, expires: expires.toISOString() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(signingKey);
  return `accensa_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}
