import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

/**
 * No fallback secret — see the note in `src/middleware.ts`. A default committed to a
 * public repository is a signing key everyone has, so a deployment missing the variable
 * would mint session tokens anyone could forge. Throwing is the correct failure: it is
 * loud, it happens on the first signing attempt, and it cannot be mistaken for working.
 */
function signingKey(): Uint8Array {
  const secretKey = process.env.JWT_SECRET_KEY;
  if (!secretKey) {
    throw new Error('JWT_SECRET_KEY is not set; refusing to sign or verify a session');
  }
  return new TextEncoder().encode(secretKey);
}

export async function encrypt(payload: Record<string, unknown>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(signingKey());
}

export async function decrypt(input: string): Promise<Record<string, unknown> | undefined> {
  const { payload } = await jwtVerify(input, signingKey(), {
    algorithms: ['HS256'],
  });
  return payload;
}

export async function createSession(publicKey: string, role: 'admin' | 'viewer' = 'admin') {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = await encrypt({ publicKey, role, expires: expires.toISOString() });
  const cookieStore = await cookies();
  cookieStore.set('accensa_session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expires,
    path: '/',
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete('accensa_session');
}
