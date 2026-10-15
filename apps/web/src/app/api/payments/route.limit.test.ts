import { expect, test, vi, describe, beforeEach } from 'vitest';
import { nativeToScVal } from '@stellar/stellar-sdk';

/**
 * The `limit` ceiling on /api/payments (#518).
 *
 * Unlike the other route tests, this one does not mock `getMaxBatchSize`: it
 * runs the real per-process cache and stubs only the Soroban simulation, so it
 * can count how many simulations a request actually costs.
 */

const { simulateTransaction, mockWithMerchantClient } = vi.hoisted(() => ({
  simulateTransaction: vi.fn(),
  mockWithMerchantClient: vi.fn(
    async (_merchantId: number, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
  ),
}));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class Server extends mod.rpc.Server {
    simulateTransaction = simulateTransaction;
  }
  return { ...mod, rpc: { ...mod.rpc, Server } };
});

vi.mock('@/lib/db', () => ({
  withClient: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({})),
  withMerchantClient: mockWithMerchantClient,
  ensureSchema: vi.fn(),
  getSyncState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: vi.fn().mockResolvedValue({ id: 1, address: 'GABC' }),
}));

/** A successful max_batch_size simulation returning `value`. */
function simulated(value: number) {
  return { result: { retval: nativeToScVal(value, { type: 'u32' }) } };
}

/** The route with a cold ceiling cache: the cache is module state. */
async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).GET;
}

const request = (limit: number | string) =>
  new Request(`http://localhost/api/payments?limit=${limit}`);

describe('/api/payments limit ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    simulateTransaction.mockReset();
    process.env.DATABASE_URL = 'postgres://dummy';
  });

  test('a second request with limit is served from the cache, with no simulation', async () => {
    simulateTransaction.mockResolvedValue(simulated(1000));
    const GET = await loadRoute();

    expect((await GET(request(50))).status).toBe(200);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);

    expect((await GET(request(50))).status).toBe(200);
    expect((await GET(request(25))).status).toBe(200);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  test('the validation error names the contract ceiling, not a hard-coded 1000', async () => {
    simulateTransaction.mockResolvedValue(simulated(250));
    const GET = await loadRoute();

    const rejected = await GET(request(251));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe('limit must be an integer between 1 and 250');

    expect((await GET(request(250))).status).toBe(200);
  });

  test('an RPC failure falls back to the 1000 default instead of answering 500', async () => {
    simulateTransaction.mockRejectedValue(new Error('rpc unreachable'));
    const GET = await loadRoute();

    expect((await GET(request(1000))).status).toBe(200);

    const rejected = await GET(request(1001));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe('limit must be an integer between 1 and 1000');
  });

  test('a request without limit does not resolve the ceiling at all', async () => {
    const GET = await loadRoute();

    expect((await GET(new Request('http://localhost/api/payments'))).status).toBe(200);
    expect(simulateTransaction).not.toHaveBeenCalled();
  });
});
