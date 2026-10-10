import { SignJWT, jwtVerify } from 'jose';

function signingKey(): Uint8Array {
  const secret = process.env.JWT_SECRET_KEY;
  if (!secret) throw new Error('JWT_SECRET_KEY is not set');
  return new TextEncoder().encode(secret);
}

export async function signActiveStoreToken(
  organizationAddress: string,
  storeAddress: string,
): Promise<string> {
  return new SignJWT({ organizationAddress, storeAddress })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(signingKey());
}

export async function activeStoreAddress(
  token: string | undefined,
  organizationAddress: string,
): Promise<string | null> {
  if (!token || !organizationAddress) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'] });
    if (
      payload.organizationAddress !== organizationAddress ||
      typeof payload.storeAddress !== 'string' ||
      !/^G[A-Z2-7]{55}$/.test(payload.storeAddress)
    ) {
      return null;
    }
    return payload.storeAddress;
  } catch {
    return null;
  }
}
