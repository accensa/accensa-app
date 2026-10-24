import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Probe behaviour read from `route.ts` (not assumed from the issue text):
 *
 * - checkRpc (global fetch to STELLAR_RPC_URL)
 *     non-2xx                -> 'unavailable'
 *     body.result.sequence   -> 'operational'
 *     anything else          -> 'degraded'
 *     fetch rejects          -> 'unavailable'
 * - checkIndexer (withClient against DATABASE_URL)
 *     DATABASE_URL unset     -> 'unavailable'
 *     query resolves         -> 'operational'
 *     query rejects          -> 'unavailable'
 *   It can never return 'degraded' or 'unknown'.
 * - checkRelayer (global fetch to FACILITATOR_URL + '/health')
 *     FACILITATOR_URL unset  -> 'unknown' (and no request)
 *     2xx                    -> 'operational'
 *     non-2xx                -> 'degraded'
 *     fetch rejects          -> 'unavailable'
 *
 * GET `Promise.all`s the three and returns them unchanged under `services`,
 * so the tests below assert the real per-probe vocabulary rather than a
 * redesigned one.
 */

const mocks = vi.hoisted(() => ({
  withClient: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ withClient: mocks.withClient }));

const RPC_URL = 'https://rpc.test';
const FACILITATOR_URL = 'https://facilitator.test';

const ORIGINALS = {
  STELLAR_RPC_URL: process.env.STELLAR_RPC_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  FACILITATOR_URL: process.env.FACILITATOR_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function installFetch(impl: FetchImpl) {
  mocks.fetch.mockImplementation(impl);
  vi.stubGlobal('fetch', mocks.fetch);
}

function rpcResponse(sequence: number | null): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: sequence === null ? {} : { sequence } }),
  } as unknown as Response;
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
}

function failedResponse(status = 503): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

function requestedUrls(): string[] {
  return mocks.fetch.mock.calls.map(([input]) => String(input));
}

async function getStatus() {
  const response = await GET();
  return { response, body: await response.json() };
}

describe('GET /api/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STELLAR_RPC_URL = RPC_URL;
    process.env.DATABASE_URL = 'postgres://test';
    process.env.FACILITATOR_URL = FACILITATOR_URL;
    mocks.withClient.mockResolvedValue(undefined);
    installFetch(async (input) =>
      String(input).startsWith(RPC_URL) ? rpcResponse(1) : okResponse(),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv();
  });

  it('reports all three service keys and a timestamp', async () => {
    const { response, body } = await getStatus();

    expect(response.status).toBe(200);
    expect(Object.keys(body.services).sort()).toEqual(['indexer', 'relayer', 'rpc']);
    expect(typeof body.checkedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it('passes every rpc state through aggregation unchanged', async () => {
    installFetch(async (input) =>
      String(input).startsWith(RPC_URL) ? rpcResponse(12) : okResponse(),
    );
    expect((await getStatus()).body.services.rpc).toBe('operational');

    installFetch(async (input) =>
      String(input).startsWith(RPC_URL) ? rpcResponse(null) : okResponse(),
    );
    expect((await getStatus()).body.services.rpc).toBe('degraded');

    installFetch(async (input) =>
      String(input).startsWith(RPC_URL) ? failedResponse() : okResponse(),
    );
    expect((await getStatus()).body.services.rpc).toBe('unavailable');
  });

  it('passes every indexer state through aggregation unchanged', async () => {
    mocks.withClient.mockResolvedValue(undefined);
    expect((await getStatus()).body.services.indexer).toBe('operational');

    mocks.withClient.mockRejectedValue(new Error('connection refused'));
    expect((await getStatus()).body.services.indexer).toBe('unavailable');
  });

  it('passes every relayer state through aggregation unchanged', async () => {
    installFetch(async (input) =>
      String(input).startsWith(FACILITATOR_URL) ? okResponse() : rpcResponse(1),
    );
    expect((await getStatus()).body.services.relayer).toBe('operational');

    installFetch(async (input) =>
      String(input).startsWith(FACILITATOR_URL) ? failedResponse() : rpcResponse(1),
    );
    expect((await getStatus()).body.services.relayer).toBe('degraded');

    installFetch(async (input) => {
      if (String(input).startsWith(FACILITATOR_URL)) throw new Error('relayer down');
      return rpcResponse(1);
    });
    expect((await getStatus()).body.services.relayer).toBe('unavailable');

    delete process.env.FACILITATOR_URL;
    expect((await getStatus()).body.services.relayer).toBe('unknown');
  });

  it('keeps all three values in a mixed result', async () => {
    // The issue's example used `indexer: 'degraded'`, which checkIndexer cannot
    // produce; this is the closest producible triple with three distinct values.
    installFetch(async (input) => {
      if (String(input).startsWith(RPC_URL)) return rpcResponse(null);
      if (String(input).startsWith(FACILITATOR_URL)) throw new Error('relayer down');
      return okResponse();
    });
    mocks.withClient.mockResolvedValue(undefined);

    const { body } = await getStatus();

    expect(body.services).toEqual({
      rpc: 'degraded',
      indexer: 'operational',
      relayer: 'unavailable',
    });
  });

  it('reports the other two services when one probe fails', async () => {
    installFetch(async (input) => {
      if (String(input).startsWith(FACILITATOR_URL)) throw new Error('relayer down');
      return rpcResponse(1);
    });

    const { response, body } = await getStatus();

    expect(response.status).toBe(200);
    expect(body.services.rpc).toBe('operational');
    expect(body.services.indexer).toBe('operational');
    expect(body.services.relayer).toBe('unavailable');
  });

  it('maps a rejected fetch to unavailable without throwing', async () => {
    installFetch(async (input) => {
      if (String(input).startsWith(RPC_URL)) throw new Error('rpc unreachable');
      return okResponse();
    });

    const { response, body } = await getStatus();

    expect(response.status).toBe(200);
    expect(body.services.rpc).toBe('unavailable');
  });

  it('reports the relayer as unknown and issues no relayer request when FACILITATOR_URL is unset', async () => {
    delete process.env.FACILITATOR_URL;

    const { body } = await getStatus();

    expect(body.services.relayer).toBe('unknown');

    const urls = requestedUrls();
    expect(urls.some((url) => url.includes('facilitator'))).toBe(false);
    expect(urls.some((url) => url.endsWith('/health'))).toBe(false);
    // The rpc probe does use the same global fetch, so asserting that fetch was
    // called at all proves the spy is live; the two checks above prove it was
    // never called for the relayer.
    expect(urls.some((url) => url.startsWith(RPC_URL))).toBe(true);
  });

  it('treats a probe that times out as unavailable', async () => {
    // AbortSignal.timeout is not driven by fake timers, so the timeout is
    // simulated with a fetch that rejects with a TimeoutError rather than
    // waiting the real five seconds.
    installFetch(async (input) => {
      if (String(input).startsWith(RPC_URL)) {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return okResponse();
    });

    const { response, body } = await getStatus();

    expect(response.status).toBe(200);
    expect(body.services.rpc).toBe('unavailable');
  });
});
