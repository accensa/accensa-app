import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { POST } from './route';

const TEST_SECRET = 'totp-verify-route-test-secret';
const MERCHANT = { id: 42, address: 'GABC' };
const CODE = '123456';
const BACKUP = 'ABCD-1234';

const m = vi.hoisted(() => ({
  withClient: vi.fn(),
  getMerchantByAddress: vi.fn(),
  activateTotp: vi.fn(),
  redeemBackupCode: vi.fn(),
  decryptTotpSecret: vi.fn(),
  verifyTotpToken: vi.fn(),
  isTotpEnabled: vi.fn(),
  disableTotp: vi.fn(),
  getTotpRecord: vi.fn(),
  mintChallengeToken: vi.fn(),
  checkTotpRateLimit: vi.fn(),
  clearTotpAttempts: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ withClient: m.withClient }));
vi.mock('@/lib/merchants', () => ({ getMerchantByAddress: m.getMerchantByAddress }));
vi.mock('@/lib/auth/totp', () => ({
  activateTotp: m.activateTotp,
  redeemBackupCode: m.redeemBackupCode,
  decryptTotpSecret: m.decryptTotpSecret,
  verifyTotpToken: m.verifyTotpToken,
  isTotpEnabled: m.isTotpEnabled,
  disableTotp: m.disableTotp,
  getTotpRecord: m.getTotpRecord,
}));
vi.mock('@/lib/auth/totp-challenge', () => ({ mintChallengeToken: m.mintChallengeToken }));
vi.mock('@/lib/auth/totp-rate-limit', () => ({
  checkTotpRateLimit: m.checkTotpRateLimit,
  clearTotpAttempts: m.clearTotpAttempts,
}));

/** Mints a session cookie the route's real `sessionFromRequest` will verify. */
async function mintSessionCookie(
  payload: Record<string, unknown> = { publicKey: MERCHANT.address, role: 'admin' },
  secret = TEST_SECRET,
): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(new TextEncoder().encode(secret));
}

const post = (body: unknown, opts: { cookie?: string; headers?: Record<string, string> } = {}) =>
  POST(
    new Request('http://localhost/api/auth/totp/verify', {
      method: 'POST',
      headers: {
        ...(opts.cookie ? { cookie: `accensa_session=${opts.cookie}` } : {}),
        ...opts.headers,
      },
      body: JSON.stringify(body),
    }),
  );

describe('/api/auth/totp/verify POST', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET_KEY = TEST_SECRET;
    m.withClient.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn({}));
    m.getMerchantByAddress.mockResolvedValue(MERCHANT);
    m.checkTotpRateLimit.mockResolvedValue({ success: true });
    m.isTotpEnabled.mockResolvedValue(true);
    m.getTotpRecord.mockResolvedValue({ secretEncrypted: 'enc' });
    m.decryptTotpSecret.mockReturnValue('secret');
    m.verifyTotpToken.mockReturnValue(true);
    m.redeemBackupCode.mockResolvedValue(false);
    m.mintChallengeToken.mockReturnValue('signed-token');
  });

  describe('session requirement', () => {
    it('returns 401 when the request carries no session cookie', async () => {
      const res = await post({ token: CODE });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(m.getMerchantByAddress).not.toHaveBeenCalled();
      expect(m.checkTotpRateLimit).not.toHaveBeenCalled();
      expect(m.verifyTotpToken).not.toHaveBeenCalled();
      expect(m.mintChallengeToken).not.toHaveBeenCalled();
    });

    it('returns 401 when the session cookie is forged (signed under another key)', async () => {
      const cookie = await mintSessionCookie(
        { publicKey: MERCHANT.address, role: 'admin' },
        'some-other-secret',
      );
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(m.getMerchantByAddress).not.toHaveBeenCalled();
      expect(m.checkTotpRateLimit).not.toHaveBeenCalled();
    });

    it('ignores a spoofed x-accensa-merchant header on a sessionless request', async () => {
      const res = await post(
        { token: CODE },
        { headers: { 'x-accensa-merchant': MERCHANT.address } },
      );
      expect(res.status).toBe(401);
      expect(m.getMerchantByAddress).not.toHaveBeenCalled();
    });

    it('returns 401 when the session address names no merchant on this deployment', async () => {
      m.getMerchantByAddress.mockResolvedValue(null);
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(m.getMerchantByAddress).toHaveBeenCalledWith({}, MERCHANT.address);
      expect(m.checkTotpRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('request validation', () => {
    it('returns 400 for a non-JSON body', async () => {
      const cookie = await mintSessionCookie();
      const res = await POST(
        new Request('http://localhost/api/auth/totp/verify', {
          method: 'POST',
          headers: { cookie: `accensa_session=${cookie}` },
          body: 'nope',
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it.each([[{}], [{ token: 123456 }], [{ token: '12345' }], [{ token: 'abcdef' }]])(
      'returns 400 for malformed token %j',
      async (body) => {
        const cookie = await mintSessionCookie();
        const res = await post(body, { cookie });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/6-digit code or a AAAA-BBBB backup code/);
        expect(m.checkTotpRateLimit).not.toHaveBeenCalled();
      },
    );

    it('returns 429 and performs no code verification when rate limited', async () => {
      m.checkTotpRateLimit.mockResolvedValue({ success: false });
      const cookie = await mintSessionCookie();
      for (const body of [
        { token: CODE },
        { token: CODE, activate: true },
        { token: CODE, disable: true },
      ]) {
        const res = await post(body, { cookie });
        expect(res.status).toBe(429);
      }
      expect(m.checkTotpRateLimit).toHaveBeenCalledWith(MERCHANT.id);
      expect(m.verifyTotpToken).not.toHaveBeenCalled();
      expect(m.redeemBackupCode).not.toHaveBeenCalled();
      expect(m.activateTotp).not.toHaveBeenCalled();
      expect(m.isTotpEnabled).not.toHaveBeenCalled();
      expect(m.disableTotp).not.toHaveBeenCalled();
      expect(m.mintChallengeToken).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('returns 400 when the merchant is not enrolled', async () => {
      m.activateTotp.mockResolvedValue({ ok: false, reason: 'not_enrolled' });
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, activate: true }, { cookie });
      expect(res.status).toBe(400);
      expect(m.clearTotpAttempts).not.toHaveBeenCalled();
    });

    it('returns 401 for a wrong code', async () => {
      m.activateTotp.mockResolvedValue({ ok: false, reason: 'invalid_code' });
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, activate: true }, { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid code' });
      expect(m.clearTotpAttempts).not.toHaveBeenCalled();
    });

    it('returns { success, activated } and clears attempts on success', async () => {
      m.activateTotp.mockResolvedValue({ ok: true });
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, activate: true }, { cookie });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, activated: true });
      expect(m.activateTotp).toHaveBeenCalledWith({}, MERCHANT.id, CODE);
      expect(m.clearTotpAttempts).toHaveBeenCalledWith(MERCHANT.id);
    });
  });

  describe('disable', () => {
    it('returns 400 when TOTP is not enabled', async () => {
      m.isTotpEnabled.mockResolvedValue(false);
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, disable: true }, { cookie });
      expect(res.status).toBe(400);
      expect(m.disableTotp).not.toHaveBeenCalled();
    });

    it('returns 401 for a wrong code and keeps the enrollment', async () => {
      m.verifyTotpToken.mockReturnValue(false);
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, disable: true }, { cookie });
      expect(res.status).toBe(401);
      expect(m.disableTotp).not.toHaveBeenCalled();
    });

    it('returns { success, disabled } for a valid code', async () => {
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE, disable: true }, { cookie });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, disabled: true });
      expect(m.disableTotp).toHaveBeenCalledWith({}, MERCHANT.id);
      expect(m.clearTotpAttempts).toHaveBeenCalledWith(MERCHANT.id);
    });

    it('accepts a redeemable backup code', async () => {
      m.redeemBackupCode.mockResolvedValue(true);
      const cookie = await mintSessionCookie();
      const res = await post({ token: BACKUP, disable: true }, { cookie });
      expect(await res.json()).toEqual({ success: true, disabled: true });
    });
  });

  describe('challenge', () => {
    it('returns 400 when TOTP is not enabled', async () => {
      m.isTotpEnabled.mockResolvedValue(false);
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Two-factor authentication is not enabled' });
      expect(m.mintChallengeToken).not.toHaveBeenCalled();
    });

    it('returns a signed challenge token for a valid TOTP code', async () => {
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        codeUsed: 'totp',
        challengeToken: 'signed-token',
        expiresInMs: 120000,
      });
      expect(m.mintChallengeToken).toHaveBeenCalledWith(MERCHANT.id);
      expect(m.clearTotpAttempts).toHaveBeenCalledWith(MERCHANT.id);
    });

    it('takes the same success path for a redeemable backup code', async () => {
      m.verifyTotpToken.mockReturnValue(false);
      m.redeemBackupCode.mockResolvedValue(true);
      const cookie = await mintSessionCookie();
      const res = await post({ token: BACKUP }, { cookie });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        codeUsed: 'backup',
        challengeToken: 'signed-token',
        expiresInMs: 120000,
      });
      expect(m.clearTotpAttempts).toHaveBeenCalledWith(MERCHANT.id);
    });

    it('returns 401 when neither a TOTP nor a backup code matches', async () => {
      m.verifyTotpToken.mockReturnValue(false);
      const cookie = await mintSessionCookie();
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid code' });
      expect(m.mintChallengeToken).not.toHaveBeenCalled();
      expect(m.clearTotpAttempts).not.toHaveBeenCalled();
    });

    it('returns 500 when a helper throws', async () => {
      m.isTotpEnabled.mockRejectedValue(new Error('db'));
      const cookie = await mintSessionCookie();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await post({ token: CODE }, { cookie });
      expect(res.status).toBe(500);
      spy.mockRestore();
    });
  });
});
