import {
  randomBytes,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'crypto';
import type { Client } from 'pg';

/**
 * TOTP two-factor authentication for sensitive merchant settings (#411).
 *
 * Standard RFC 6238 TOTP over SHA-1 with 6-digit codes and 30-second steps —
 * the combination every mainstream authenticator app (Google Authenticator,
 * Authy, 1Password) generates by default when scanning a provisioning URI, so
 * onboarding needs no app-specific settings and no vendor library.
 *
 * Secret at rest: TOTP verification is an HMAC over the secret itself, so —
 * unlike a password — the server must be able to recover it to check codes.
 * It is therefore stored AES-256-GCM-encrypted under a domain-separated
 * subkey of the deployment's existing `JWT_SECRET_KEY`: a database leak alone
 * (a SQL injection, a leaked dump) does not yield usable secrets, and no new
 * environment variable is required. Backup codes, by contrast, are checked
 * hash-style (they are redeemed, not fed to an HMAC), so only their SHA-256
 * digests are ever stored.
 */

export interface TotpConfig {
  secret: string;
  uri: string;
}

/** The generated enrollment, ready for the QR code and one-time display. */
export interface GeneratedTotpSecret {
  /** Base32 secret shown in the QR code / manual entry. */
  secret: string;
  /** otpauth:// provisioning URI for QR encoding. */
  uri: string;
  /** The secret as it is stored (AES-256-GCM encrypted). */
  secretEncrypted: string;
  /** Single-use recovery codes (plaintext, shown exactly once). */
  backupCodes: string[];
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const CODE_DIGITS = 6;
/** Steps of clock skew tolerated either side of the server's current step. */
const ALLOWED_DRIFT = 1n;

function jwtDerivedKey(): Buffer {
  const secretKey = process.env.JWT_SECRET_KEY;
  if (!secretKey) {
    throw new Error('JWT_SECRET_KEY is not set; refusing to encrypt or decrypt a TOTP secret');
  }
  // Domain separation: this subkey is for TOTP secret encryption only, never
  // for signing sessions or anything else that derives from the same secret.
  return createHash('sha256').update(`accensa:totp-aes:${secretKey}`, 'utf8').digest();
}

/** Encrypts a base32 secret for storage. Format: v1:iv:tag:ciphertext (base64). */
export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', jwtDerivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Reverses `encryptTotpSecret`. Throws on tampering (GCM tag mismatch). */
export function decryptTotpSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognised TOTP secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', jwtDerivedKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Rough entropy: 20 random bytes → 32 base32 chars, the authenticator norm. */
export function generateBase32Secret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Builds an `otpauth://` provisioning URI.
 *
 * The label is `issuer:account`, the two-line entry name mainstream
 * authenticator apps render when the QR is scanned.
 */
export function generateTotpUri(secret: string, userEmail: string, issuer = 'Accensa'): string {
  const label = encodeURIComponent(`${issuer}:${userEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    period: String(STEP_MS / 1000),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateTotpSecret(userEmail: string, issuer = 'Accensa'): GeneratedTotpSecret {
  const secret = generateBase32Secret();
  return {
    secret,
    uri: generateTotpUri(secret, userEmail, issuer),
    secretEncrypted: encryptTotpSecret(secret),
    backupCodes: generateBackupCodes(),
  };
}

/** A 30-second step index from the Unix epoch. `at` is in milliseconds. */
function timeStep(at: number): bigint {
  return BigInt(Math.floor(at / STEP_MS));
}

/** RFC 4226 HOTP over the TOTP time step — the core of RFC 6238. */
function hotp(secret: string, counter: bigint): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);

  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return (binary % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Verifies a 6-digit TOTP token against the base32 secret.
 *
 * Accepts the token for the current step or ±1 step either side of it, which
 * absorbs the small clock skew between the merchant's phone and the server
 * without widening the brute-force window meaningfully (rate limiting on the
 * route, not this function, is what stops guessing — see `checkTotpRateLimit`).
 *
 * The comparison is constant-time (`timingSafeEqual`) so a token's correctness
 * is not observable through response timing.
 */
export function verifyTotpToken(token: string, secret: string, at: number = Date.now()): boolean {
  const clean = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const submittedBuf = Buffer.from(clean, 'utf8');
  const step = timeStep(at);
  for (const drift of [-ALLOWED_DRIFT, 0n, ALLOWED_DRIFT]) {
    const expected = hotp(secret, step + drift);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (expectedBuf.length === submittedBuf.length && timingSafeEqual(expectedBuf, submittedBuf)) {
      return true;
    }
  }
  return false;
}

/** Generates single-use recovery codes in the AAAA-BBBB form. */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** Hashes a batch of backup codes for storage. */
export function hashBackupCodes(codes: string[]): string[] {
  return codes.map((c) => hashBackupCode(c));
}

/** SHA-256 hex of a canonicalised backup code — the only stored form. */
export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Persistence. Mirrors the self-contained schema pattern used by
// notifications.ts: the table is created on demand so a fresh database needs
// no manual migration, and every query is scoped by merchant_id.
// ---------------------------------------------------------------------------

async function ensureTotpSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS merchant_totp (
      merchant_id INT PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      backup_code_hashes TEXT[] NOT NULL DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      enabled_at TIMESTAMPTZ
    );
  `);
}

/**
 * A pending TOTP enrollment: the secret exists but is not active until a valid
 * code has been verified once. Re-enrolling overwrites the pending secret —
 * a merchant who abandons setup halfway and restarts gets a fresh QR code.
 */
export async function storePendingTotpSecret(
  client: Client,
  merchantId: number,
  secretEncrypted: string,
  backupCodeHashes: string[],
): Promise<void> {
  await ensureTotpSchema(client);
  await client.query(
    `INSERT INTO merchant_totp (merchant_id, secret_encrypted, backup_code_hashes, enabled)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (merchant_id) DO UPDATE
     SET secret_encrypted = EXCLUDED.secret_encrypted,
         backup_code_hashes = EXCLUDED.backup_code_hashes,
         enabled = false,
         enabled_at = NULL`,
    [merchantId, secretEncrypted, backupCodeHashes],
  );
}

/** The stored enrollment for a merchant, or null when none exists. */
export interface TotpRecord {
  secretEncrypted: string;
  backupCodeHashes: string[];
  enabled: boolean;
}

export async function getTotpRecord(
  client: Client,
  merchantId: number,
): Promise<TotpRecord | null> {
  await ensureTotpSchema(client);
  const res = await client.query<{
    secret_encrypted: string;
    backup_code_hashes: string[];
    enabled: boolean;
  }>(
    `SELECT secret_encrypted, backup_code_hashes, enabled
     FROM merchant_totp WHERE merchant_id = $1`,
    [merchantId],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    secretEncrypted: row.secret_encrypted,
    backupCodeHashes: row.backup_code_hashes ?? [],
    enabled: row.enabled,
  };
}

/**
 * Activates a pending enrollment after a valid code is presented.
 *
 * Returns whether activation succeeded. `not_enrolled` means no pending
 * secret exists (the merchant never started setup, or the row was cleared);
 * `invalid_token` speaks for itself. An already-enabled record is idempotent
 * success — re-scanning the QR code after enabling does not error.
 */
export async function activateTotp(
  client: Client,
  merchantId: number,
  token: string,
): Promise<{ ok: boolean; reason?: 'not_enrolled' | 'invalid_token' }> {
  const record = await getTotpRecord(client, merchantId);
  if (!record) return { ok: false, reason: 'not_enrolled' };
  if (record.enabled) return { ok: true };

  let secret: string;
  try {
    secret = decryptTotpSecret(record.secretEncrypted);
  } catch {
    return { ok: false, reason: 'invalid_token' };
  }
  if (!verifyTotpToken(token, secret)) {
    return { ok: false, reason: 'invalid_token' };
  }
  await ensureTotpSchema(client);
  await client.query(
    `UPDATE merchant_totp SET enabled = true, enabled_at = now() WHERE merchant_id = $1`,
    [merchantId],
  );
  return { ok: true };
}

/** Whether 2FA is active for a merchant (an enabled, verified enrollment). */
export async function isTotpEnabled(client: Client, merchantId: number): Promise<boolean> {
  const record = await getTotpRecord(client, merchantId);
  return record?.enabled === true;
}

/**
 * Removes the merchant's TOTP enrollment.
 *
 * Requires a currently-valid TOTP token *or* an unredeemed backup code —
 * enforced by the caller; this function only clears the row once the
 * challenge has been satisfied.
 */
export async function disableTotp(client: Client, merchantId: number): Promise<void> {
  await ensureTotpSchema(client);
  await client.query(`DELETE FROM merchant_totp WHERE merchant_id = $1`, [merchantId]);
}

/**
 * Redeems one backup code, marking it consumed so it cannot be reused.
 *
 * The consumed code is removed in the same UPDATE that confirms the match,
 * and the UPDATE is guarded by array-containment so two concurrent
 * submissions of the same code cannot both succeed: whichever statement runs
 * second no longer finds the code in the array and updates zero rows.
 */
export async function redeemBackupCode(
  client: Client,
  merchantId: number,
  code: string,
): Promise<boolean> {
  const record = await getTotpRecord(client, merchantId);
  if (!record || record.backupCodeHashes.length === 0) return false;

  const target = hashBackupCode(code);
  if (!record.backupCodeHashes.includes(target)) return false;

  const remaining = record.backupCodeHashes.filter((h) => h !== target);
  await ensureTotpSchema(client);
  const res = await client.query(
    `UPDATE merchant_totp
     SET backup_code_hashes = $2
     WHERE merchant_id = $1 AND backup_code_hashes @> $3`,
    [merchantId, remaining, [target]],
  );
  return (res.rowCount ?? 0) > 0;
}
