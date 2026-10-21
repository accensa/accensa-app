import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import * as crypto from 'node:crypto';

const PUBLIC_KEY_HEX = 'dfac12734284a3fd741b1392f7f545496462efa5ad0fb45f5d5ce79a09d46b2f';
const PRIVATE_KEY_HEX = '49df29e01fc8c973ea614aabdaed9041a9bc99c43e49e01c5188bfcc65bb33a1';

const { mockRecordSettlement, mockConsumeSettlementNonce } = vi.hoisted(() => ({
  mockRecordSettlement: vi.fn().mockResolvedValue({ matchedExistingPayment: false }),
  mockConsumeSettlementNonce: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (cb: (client: unknown) => unknown) => cb({ query: vi.fn() })),
  withMerchantClient: vi.fn(async (_merchantId: number, cb: (client: unknown) => unknown) =>
    cb({ query: vi.fn(async () => ({ rowCount: 0, rows: [] })) }),
  ),
  ensureSchema: vi.fn(),
  recordSettlement: mockRecordSettlement,
  consumeSettlementNonce: mockConsumeSettlementNonce,
}));

vi.mock('@/lib/merchants', () => ({
  listMerchants: vi.fn(async () => [{ id: 1, address: 'GABC', publicKeyHex: PUBLIC_KEY_HEX }]),
}));

describe('POST /api/hook/settle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  const sign = (payload: string) => {
    const keyBuffer = Buffer.from(PRIVATE_KEY_HEX, 'hex');
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), keyBuffer]),
      format: 'der',
      type: 'pkcs8',
    });
    return crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex');
  };

  it('verifies a payload with non-ASCII and float, resolving the reporting merchant', async () => {
    const rawBody = `{"tx_hash":"${'a'.repeat(64)}","route":"/café","method":"GET","amount":1.0}`;
    const req = new Request('http://localhost/api/hook/settle', {
      method: 'POST',
      headers: {
        'x-signature': sign(rawBody),
      },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockRecordSettlement).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ txHash: 'a'.repeat(64) }),
    );
  });

  it('rejects tampered body', async () => {
    const rawBody = `{"tx_hash":"${'a'.repeat(64)}","route":"/café","method":"GET","amount":1.0}`;
    const tamperedBody = `{"tx_hash":"${'a'.repeat(64)}","route":"/cafe","method":"GET","amount":1.0}`;
    const req = new Request('http://localhost/api/hook/settle', {
      method: 'POST',
      headers: {
        'x-signature': sign(rawBody),
      },
      body: tamperedBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 for unparseable body that passes signature', async () => {
    const rawBody = `not json`;
    const req = new Request('http://localhost/api/hook/settle', {
      method: 'POST',
      headers: {
        'x-signature': sign(rawBody),
      },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a signature that matches no configured merchant', async () => {
    const rawBody = `{"tx_hash":"${'b'.repeat(64)}","route":"/x","method":"GET"}`;
    const req = new Request('http://localhost/api/hook/settle', {
      method: 'POST',
      headers: { 'x-signature': 'a'.repeat(128) },
      body: rawBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  const signedRequest = (rawBody: string) =>
    new Request('http://localhost/api/hook/settle', {
      method: 'POST',
      headers: { 'x-signature': sign(rawBody) },
      body: rawBody,
    });

  it('accepts a fresh report inside the five-minute window', async () => {
    const rawBody = JSON.stringify({
      tx_hash: 'c'.repeat(64),
      route: '/api/fresh',
      method: 'GET',
      reported_at: new Date().toISOString(),
    });

    const res = await POST(signedRequest(rawBody));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recorded).toBe(true);
    // The signature was claimed once, in its normalized (lower-case) form.
    expect(mockConsumeSettlementNonce).toHaveBeenCalledTimes(1);
    expect(mockConsumeSettlementNonce).toHaveBeenCalledWith(
      expect.anything(),
      sign(rawBody).toLowerCase(),
      1,
    );
    expect(mockRecordSettlement).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale report outside the accepted window with a typed error', async () => {
    const rawBody = JSON.stringify({
      tx_hash: 'd'.repeat(64),
      route: '/api/stale',
      method: 'GET',
      // Ten minutes old: inside no plausible window, and the signed timestamp
      // cannot be refreshed without invalidating the signature.
      reported_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    const res = await POST(signedRequest(rawBody));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('report_too_old');
    // Rejected before anything was claimed or written.
    expect(mockConsumeSettlementNonce).not.toHaveBeenCalled();
    expect(mockRecordSettlement).not.toHaveBeenCalled();
  });

  it('rejects a future-dated report with a typed error', async () => {
    const rawBody = JSON.stringify({
      tx_hash: 'f'.repeat(64),
      route: '/api/future',
      method: 'GET',
      reported_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const res = await POST(signedRequest(rawBody));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('report_future_dated');
    expect(mockRecordSettlement).not.toHaveBeenCalled();
  });

  it('rejects a replayed signed body without changing attribution', async () => {
    const rawBody = JSON.stringify({
      tx_hash: 'e'.repeat(64),
      route: '/api/replay',
      method: 'GET',
      reported_at: new Date().toISOString(),
    });
    const req = () => signedRequest(rawBody);

    // First presentation claims the nonce; the store reports the second as
    // already consumed — which is exactly what a database-backed claim does
    // after a restart, since the row lives in `settle_nonces`, not memory.
    mockConsumeSettlementNonce.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await POST(req());
    expect(first.status).toBe(200);

    // Byte-identical body → identical signature → replay.
    const second = await POST(req());
    expect(second.status).toBe(401);
    const data = await second.json();
    expect(data.code).toBe('report_replayed');

    // Attribution was written exactly once; the replay never reached the write.
    expect(mockRecordSettlement).toHaveBeenCalledTimes(1);
    expect(mockConsumeSettlementNonce).toHaveBeenCalledTimes(2);
  });
});
