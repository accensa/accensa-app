import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const check = vi.fn(async (_object: string, _permission: string, _user: string) => false);
  return {
    check,
    zanzibarClient: vi.fn(() => ({ check, list: vi.fn() })),
    withMerchantClient: vi.fn(
      async (_merchantId: number, callback: (client: object) => Promise<unknown>) => callback({}),
    ),
  };
});

vi.mock('@/lib/db', () => ({ withMerchantClient: mocks.withMerchantClient }));
vi.mock('./store', () => ({
  zanzibarClient: mocks.zanzibarClient,
  objectOf: (merchantId: number) => `merchant:${merchantId}`,
}));

import { authorize, can } from './permissions';
import { PERMISSIONS } from './schema';

const MERCHANT = { id: 7 };

function requestWith(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/roles', { headers });
}

describe('authorize (#830)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue(true);
  });

  it('returns 400 for an unknown permission before touching the store', async () => {
    const res = await authorize('self_destruct', { merchant: MERCHANT, subject: 'u_abc' });

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: 'unknown permission: self_destruct' });
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
  });

  it('returns 401 when no merchant resolves', async () => {
    const res = await authorize(PERMISSIONS.VIEW_PAYMENTS, {});

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
  });

  it('returns 401 when no subject is supplied or present on the request', async () => {
    const explicit = await authorize(PERMISSIONS.VIEW_PAYMENTS, { merchant: MERCHANT });
    const fromHeaders = await authorize(PERMISSIONS.VIEW_PAYMENTS, {
      merchant: MERCHANT,
      request: requestWith(),
    });

    expect(explicit?.status).toBe(401);
    expect(fromHeaders?.status).toBe(401);
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
  });

  it('extracts the subject from x-accensa-sub and normalizes it to a user ref', async () => {
    const res = await authorize(PERMISSIONS.VIEW_PAYMENTS, {
      merchant: MERCHANT,
      request: requestWith({ 'x-accensa-sub': 'u_header' }),
    });

    expect(res).toBeNull();
    expect(mocks.withMerchantClient).toHaveBeenCalledWith(7, expect.any(Function));
    expect(mocks.check).toHaveBeenCalledWith('merchant:7', 'view_payments', 'user:u_header');
  });

  it('extracts the subject from an Authorization bearer token', async () => {
    const res = await authorize(PERMISSIONS.VIEW_DASHBOARD, {
      merchant: MERCHANT,
      request: requestWith({ authorization: 'Bearer u_bearer' }),
    });

    expect(res).toBeNull();
    expect(mocks.check).toHaveBeenCalledWith('merchant:7', 'view_dashboard', 'user:u_bearer');
  });

  it('prefers an explicit subject and does not double-prefix a user ref', async () => {
    const res = await authorize(PERMISSIONS.MANAGE_TEAM, {
      merchant: MERCHANT,
      subject: 'user:u_explicit',
      request: requestWith({ 'x-accensa-sub': 'u_header' }),
    });

    expect(res).toBeNull();
    expect(mocks.check).toHaveBeenCalledWith('merchant:7', 'manage_team', 'user:u_explicit');
  });

  it('returns null when Zanzibar allows the check', async () => {
    const res = await authorize(PERMISSIONS.EDIT_MERCHANT, {
      merchant: MERCHANT,
      subject: 'u_abc',
    });

    expect(res).toBeNull();
  });

  it('returns 403 when Zanzibar denies the check or no client is available', async () => {
    mocks.check.mockResolvedValue(false);
    const denied = await authorize(PERMISSIONS.VIEW_PAYMENTS, {
      merchant: MERCHANT,
      subject: 'u_abc',
    });

    mocks.zanzibarClient.mockReturnValueOnce(null as never);
    const noClient = await authorize(PERMISSIONS.VIEW_PAYMENTS, {
      merchant: MERCHANT,
      subject: 'u_abc',
    });

    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: 'Permission denied: view_payments' });
    expect(noClient?.status).toBe(403);
  });

  it('exposes the allow/deny decision through can()', async () => {
    const opts = { merchant: MERCHANT, subject: 'u_abc' };

    expect(await can(PERMISSIONS.VIEW_DASHBOARD, opts)).toBe(true);

    mocks.check.mockResolvedValue(false);
    expect(await can(PERMISSIONS.VIEW_DASHBOARD, opts)).toBe(false);
  });
});
