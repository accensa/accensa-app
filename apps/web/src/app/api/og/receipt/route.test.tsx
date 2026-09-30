import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { mockGetPublicReceiptShare } = vi.hoisted(() => ({
  mockGetPublicReceiptShare: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  withClient: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
}));
vi.mock('@/lib/receipt-share', () => ({ getPublicReceiptShare: mockGetPublicReceiptShare }));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(_element: unknown, options: { headers?: HeadersInit } = {}) {
      const headers = new Headers(options.headers);
      headers.set('Content-Type', 'image/png');
      super('image', { status: 200, headers });
    }
  },
}));

describe('GET /api/og/receipt', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test';
    mockGetPublicReceiptShare.mockReset();
  });

  it('rejects malformed transaction hashes before the database lookup', async () => {
    const response = await GET(new Request('https://app.example/api/og/receipt?txHash=nope'));
    expect(response.status).toBe(400);
    expect(mockGetPublicReceiptShare).not.toHaveBeenCalled();
  });

  it('does not generate a public card until the receipt is anchored', async () => {
    mockGetPublicReceiptShare.mockResolvedValue(null);
    const response = await GET(
      new Request(`https://app.example/api/og/receipt?txHash=${'a'.repeat(64)}`),
    );
    expect(response.status).toBe(404);
  });

  it('returns a PNG card for an anchored public receipt', async () => {
    mockGetPublicReceiptShare.mockResolvedValue({
      txHash: 'a'.repeat(64),
      merchantAddress: 'G' + 'A'.repeat(55),
      amount: '3.25',
      asset: 'native',
      batchId: 12,
    });
    const response = await GET(
      new Request(`https://app.example/api/og/receipt?txHash=${'a'.repeat(64)}`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
  });
});
