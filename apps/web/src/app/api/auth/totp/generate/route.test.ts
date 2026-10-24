import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { POST } from './route';

const TEST_SECRET = 'totp-generate-route-test-secret';
const MERCHANT = { id: 42, address: 'GABC' };
const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  secretEncrypted: 'enc',
  uri: 'otpauth://totp/Accensa:GABC?secret=JBSWY3DPEHPK3PXP',
  backupCodes: ['ABCD-1234', 'EFGH-5678'],
};

const m = vi.hoisted(() => ({
  withClient: vi.fn(),
  getMerchantByAddress: vi.fn(),
  generateTotpSecret: vi.fn(),
  storePendingTotpSecret: vi.fn(),
  hashBackupCodes: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ withClient: m.withClient }));
vi.mock('@/lib/merchants', () => ({ getMerchantByAddress: m.getMerchantByAddress }));
vi.mock('@/lib/auth/totp', () => ({
  generateTotpSecret: m.generateTotpSecret,
  storePendingTotpSecret: m.storePendingTotpSecret,
  hashBackupCodes: m.hashBackupCodes,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: m.toDataURL } }));

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

const post = (opts: { cookie?: string; headers?: Record<string, string> } = {}) =>
  POST(
    new Request('http://localhost/api/auth/totp/generate', {
      method: 'POST',
      headers: {
        ...(opts.cookie ? { cookie: `accensa_session=${opts.cookie}` } : {}),
        ...opts.headers,
      },
    }),
  );

describe('/api/auth/totp/generate POST', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.JWT_SECRET_KEY = TEST_SECRET;
    m.withClient.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn({}));
    m.getMerchantByAddress.mockResolvedValue(MERCHANT);
    m.generateTotpSecret.mockReturnValue(ENROLLMENT);
    m.hashBackupCodes.mockReturnValue('hashed-codes');
    m.storePendingTotpSecret.mockResolvedValue(undefined);
    m.toDataURL.mockResolvedValue('data:image/png;base64,QQ==');
  });

  describe('session requirement', () => {
    it('returns 401 when the request carries no session cookie', async () => {
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(m.getMerchantByAddress).not.toHaveBeenCalled();
      expect(m.generateTotpSecret).not.toHaveBeenCalled();
      expect(m.storePendingTotpSecret).not.toHaveBeenCalled();
    });

    it('returns 401 when the session cookie is forged (signed under another key)', async () => {
      const cookie = await mintSessionCookie(
        { publicKey: MERCHANT.address, role: 'admin' },
        'some-other-secret',
      );
      const res = await post({ cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(m.generateTotpSecret).not.toHaveBeenCalled();
    });

    it('ignores spoofed identity headers on a sessionless request', async () => {
      const res = await post({
        headers: {
          'x-accensa-merchant': MERCHANT.address,
          'x-accensa-role': 'admin',
        },
      });
      expect(res.status).toBe(401);
      expect(m.getMerchantByAddress).not.toHaveBeenCalled();
    });

    it('returns 401 when the session address names no merchant on this deployment', async () => {
      m.getMerchantByAddress.mockResolvedValue(null);
      const cookie = await mintSessionCookie();
      const res = await post({ cookie });
      expect(res.status).toBe(401);
      expect(m.getMerchantByAddress).toHaveBeenCalledWith({}, MERCHANT.address);
      expect(m.generateTotpSecret).not.toHaveBeenCalled();
    });
  });

  describe('role from the verified session', () => {
    it('returns 403 for a viewer session', async () => {
      const cookie = await mintSessionCookie({ publicKey: MERCHANT.address, role: 'viewer' });
      const res = await post({ cookie });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/viewer sessions cannot manage two-factor/);
      expect(m.storePendingTotpSecret).not.toHaveBeenCalled();
      expect(m.generateTotpSecret).not.toHaveBeenCalled();
    });

    it('uses the session role even when a spoofed x-accensa-role header claims admin', async () => {
      const cookie = await mintSessionCookie({ publicKey: MERCHANT.address, role: 'viewer' });
      const res = await post({ cookie, headers: { 'x-accensa-role': 'admin' } });
      expect(res.status).toBe(403);
      expect(m.storePendingTotpSecret).not.toHaveBeenCalled();
    });

    it('treats a legacy session with no role claim as admin', async () => {
      const cookie = await mintSessionCookie({ publicKey: MERCHANT.address });
      const res = await post({ cookie });
      expect(res.status).toBe(200);
    });
  });

  describe('enrollment', () => {
    it('stores a pending secret for the session merchant and returns the setup payload', async () => {
      const cookie = await mintSessionCookie();
      const res = await post({ cookie });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        secret: ENROLLMENT.secret,
        qrCodeUrl: 'data:image/png;base64,QQ==',
        backupCodes: ENROLLMENT.backupCodes,
      });
      expect(m.generateTotpSecret).toHaveBeenCalledWith(MERCHANT.address);
      expect(m.hashBackupCodes).toHaveBeenCalledWith(ENROLLMENT.backupCodes);
      expect(m.storePendingTotpSecret).toHaveBeenCalledWith({}, MERCHANT.id, 'enc', 'hashed-codes');
    });
  });
});
