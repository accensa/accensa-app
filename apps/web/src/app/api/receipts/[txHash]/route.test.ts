import { expect, test, vi, describe, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (fn: (c: unknown) => unknown) => fn({})),
  ensureSchema: vi.fn(),
}));

vi.mock('@/lib/anchor', () => ({
  getProof: vi.fn(),
}));

import { getProof } from '@/lib/anchor';

describe('GET /api/receipts/:txHash', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://dummy';
    vi.mocked(getProof).mockReset();
  });

  test('rejects a malformed hash', async () => {
    const res = await GET(new Request('http://localhost/api/receipts/abcd'), {
      params: Promise.resolve({ txHash: 'abcd' }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 when no proof has been recorded', async () => {
    vi.mocked(getProof).mockResolvedValueOnce(null);
    const tx = 'a'.repeat(64);
    const res = await GET(new Request(`http://localhost/api/receipts/${tx}`), {
      params: Promise.resolve({ txHash: tx }),
    });
    expect(res.status).toBe(404);
  });

  test('returns the stored proof for a recorded payment', async () => {
    const tx = 'a'.repeat(64);
    vi.mocked(getProof).mockResolvedValueOnce({
      txHash: tx,
      batchId: 1,
      leaf: 'b'.repeat(64),
      proof: ['c'.repeat(64)],
      root: 'd'.repeat(64),
    });
    const res = await GET(new Request(`http://localhost/api/receipts/${tx}`), {
      params: Promise.resolve({ txHash: tx }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBe(1);
    expect(body.proof).toHaveLength(1);
  });
});
