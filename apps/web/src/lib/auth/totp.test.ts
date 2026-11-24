/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  generateTotpUri,
  hashBackupCode,
  verifyTotpToken,
} from './totp';

// RFC 4226 test secret: ASCII "12345678901234567890" encoded as base32.
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('TOTP helpers', () => {
  it('accepts the known current-step code and either adjacent step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(150_000)); // RFC HOTP counter 5.

    // RFC 4226 vectors for counters 4, 5, and 6: 338314, 254676, 287922.
    expect(verifyTotpToken('254676', rfcSecret)).toBe(true);
    expect(verifyTotpToken('338314', rfcSecret)).toBe(true);
    expect(verifyTotpToken('287922', rfcSecret)).toBe(true);
  });

  it('rejects codes outside the one-step drift window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(150_000)); // Counter 5; counters 3 and 7 are too far away.

    expect(verifyTotpToken('969429', rfcSecret)).toBe(false);
    expect(verifyTotpToken('162583', rfcSecret)).toBe(false);
  });

  it('rejects malformed tokens and invalid base32 secrets without throwing', () => {
    expect(() => verifyTotpToken('123456', 'NOT*BASE32')).not.toThrow();
    expect(verifyTotpToken('123456', 'NOT*BASE32')).toBe(false);
    expect(verifyTotpToken('12345', rfcSecret)).toBe(false);
  });

  it('round-trips encrypted secrets and rejects a modified ciphertext tag', () => {
    vi.stubEnv('JWT_SECRET_KEY', 'totp-test-key-only');
    const stored = encryptTotpSecret(rfcSecret);
    expect(decryptTotpSecret(stored)).toBe(rfcSecret);

    const [version, iv, tag, ciphertext] = stored.split(':');
    const changedCiphertext = Buffer.from(ciphertext!, 'base64');
    changedCiphertext[0] = changedCiphertext[0]! ^ 0xff;
    const tampered = [version, iv, tag, changedCiphertext.toString('base64')].join(':');

    expect(() => decryptTotpSecret(tampered)).toThrow();
  });

  it('builds an otpauth URI with the account, issuer, secret, and period', () => {
    const uri = new URL(generateTotpUri(rfcSecret, 'merchant@example.com', 'Example Issuer'));

    expect(uri.protocol).toBe('otpauth:');
    expect(decodeURIComponent(uri.pathname)).toBe('/Example Issuer:merchant@example.com');
    expect(uri.searchParams.get('secret')).toBe(rfcSecret);
    expect(uri.searchParams.get('issuer')).toBe('Example Issuer');
    expect(uri.searchParams.get('period')).toBe('30');
  });

  it('hashes backup codes independent of case and surrounding whitespace', () => {
    expect(hashBackupCode(' abcd-1234 ')).toBe(hashBackupCode('ABCD-1234'));
    expect(hashBackupCode('ABCD-1234')).toBe(hashBackupCode('ABCD-1234'));
  });

  it('generateTotpSecret produces a verifiable secret at a pinned clock', () => {
    vi.stubEnv('JWT_SECRET_KEY', 'totp-test-key-only');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));

    const generated = generateTotpSecret('merchant@example.com', 'Accensa');
    expect(generated.secret).toMatch(/^[A-Z2-7]+$/);
    expect(decryptTotpSecret(generated.secretEncrypted)).toBe(generated.secret);
    expect(generated.uri).toContain('otpauth://totp/');
    expect(generated.uri).toContain('Accensa');
    expect(generated.uri).toContain(encodeURIComponent('merchant@example.com'));

    // Wrong 6-digit code is rejected; a corrupt secret returns false instead of throwing
    // (the private base32Decode throw is swallowed by verifyTotpToken).
    expect(verifyTotpToken('000000', generated.secret)).toBe(false);
    expect(() => verifyTotpToken('123456', '@@@@')).not.toThrow();
  });

  it('encryptTotpSecret refuses to run without JWT_SECRET_KEY', () => {
    vi.stubEnv('JWT_SECRET_KEY', '');
    expect(() => encryptTotpSecret(rfcSecret)).toThrow(/JWT_SECRET_KEY/);
  });

  it('decryptTotpSecret throws on a malformed payload', () => {
    vi.stubEnv('JWT_SECRET_KEY', 'totp-test-key-only');
    expect(() => decryptTotpSecret('not-a-secret')).toThrow();
  });
});
