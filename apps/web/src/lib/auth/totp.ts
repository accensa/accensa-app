import { generateSecret, generateURI, verify } from 'otplib';

export interface TotpConfig {
  secret: string;
  uri: string;
  qrCodeUrl?: string;
}

/**
 * Generates a new TOTP secret and provisioning URI.
 * @param userEmail The email of the user to identify in the authenticator app
 * @param issuer The issuer name (e.g. Accensa)
 */
export function generateTotpSecret(userEmail: string, issuer: string = 'Accensa'): TotpConfig {
  const secret = generateSecret();
  const uri = generateURI({ label: userEmail, issuer, secret });
  return { secret, uri };
}

/**
 * Verifies a given TOTP token against the secret.
 * @param token The token provided by the user
 * @param secret The secret stored in the database
 */
export function verifyTotpToken(token: string, secret: string): boolean {
  try {
    const result = verify({ token, secret });
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Generates recovery backup codes for emergencies.
 * @param count Number of codes to generate (default 10)
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = Math.random().toString(36).substring(2, 12).toUpperCase();
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}
