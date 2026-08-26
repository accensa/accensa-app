import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import * as crypto from 'node:crypto';

const PUBLIC_KEY_HEX = 'dfac12734284a3fd741b1392f7f545496462efa5ad0fb45f5d5ce79a09d46b2f';
const PRIVATE_KEY_HEX = '49df29e01fc8c973ea614aabdaed9041a9bc99c43e49e01c5188bfcc65bb33a1';

const { mockRecordSettlement } = vi.hoisted(() => ({
  mockRecordSettlement: vi.fn().mockResolvedValue({ matchedExistingPayment: false }),
}));

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (cb: (client: unknown) => unknown) => cb({})),
  withMerchantClient: vi.fn(async (_merchantId: number, cb: (client: unknown) => unknown) =>
    cb({}),
  ),
  ensureSchema: vi.fn(),
  recordSettlement: mockRecordSettlement,
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
});
