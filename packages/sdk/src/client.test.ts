import { describe, it, expect, vi } from 'vitest';
import {
  AccensaClient,
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
  AccensaRateLimitError,
} from './client';

const TX_HASH = 'a'.repeat(64);
const PAYER = 'G' + 'A'.repeat(55);

/** A payments body the indexer could return. */
const paymentsBody = {
  payments: [
    {
      tx_hash: TX_HASH,
      route: '/api/hello',
      method: 'GET',
      payer: PAYER,
      amount: '1000',
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ledger: 42,
      ts: '2026-08-20T07:22:16Z',
    },
    {
      tx_hash: 'b'.repeat(64),
      route: '/api/quote/:id',
      method: 'POST',
      payer: PAYER,
      amount: '2500',
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ledger: 43,
      ts: '2026-08-21T07:22:16Z',
    },
  ],
  next_cursor: 'bmV4dC1wYWdl',
};

const routesBody = {
  routes: [
    { route: '/api/hello', method: 'GET', total_revenue: '1000', calls: 1 },
    { route: '/api/quote/:id', method: 'POST', total_revenue: '2500', calls: 1 },
  ],
  truncated: false,
};

/** A fetch mock that serves one canned JSON body for any request. */
const jsonFetch = (body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new globalThis.Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );

const client = (fetchImpl: typeof fetch) =>
  new AccensaClient({ indexerUrl: 'https://accensa.test', fetchImpl });

describe('AccensaClient.listOrders', () => {
  it('GETs /api/payments and returns strict Order values', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const page = await client(fetchImpl).listOrders();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://accensa.test/api/payments');
    expect(page.orders).toHaveLength(2);
    expect(page.orders[0]).toMatchObject({ id: TX_HASH, productId: '/api/hello', amount: '1000' });
    expect(page.nextCursor).toBe('bmV4dC1wYWdl');
  });

  it('forwards limit and cursor as query parameters', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    await client(fetchImpl).listOrders({ limit: 25, cursor: 'bmV4dC1wYWdl' });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://accensa.test/api/payments?limit=25&cursor=bmV4dC1wYWdl',
    );
  });

  it('does not append a query string when no options are given', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    await client(fetchImpl).listOrders();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://accensa.test/api/payments');
  });
});

describe('AccensaClient.fetchOrder', () => {
  it('finds an order by transaction hash', async () => {
    const order = await client(jsonFetch(paymentsBody)).fetchOrder(TX_HASH);
    expect(order?.id).toBe(TX_HASH);
  });

  it('returns null when the hash is not in the fetched window', async () => {
    const order = await client(jsonFetch(paymentsBody)).fetchOrder('c'.repeat(64));
    expect(order).toBeNull();
  });

  it('defaults to the API-maximum page size and allows overriding it', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    await client(fetchImpl).fetchOrder(TX_HASH);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('limit=1000');

    await client(fetchImpl).fetchOrder(TX_HASH, { limit: 50 });
    expect(String(fetchImpl.mock.calls[1][0])).toContain('limit=50');
  });
});

describe('AccensaClient.listProducts', () => {
  it('GETs /api/routes and returns strict Product values', async () => {
    const fetchImpl = jsonFetch(routesBody);
    const page = await client(fetchImpl).listProducts();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://accensa.test/api/routes');
    expect(page.products).toHaveLength(2);
    expect(page.products[0]).toMatchObject({
      id: '/api/hello',
      totalRevenue: '1000',
      calls: 1,
    });
    expect(page.truncated).toBe(false);
  });

  it('forwards limit, from, and to as query parameters', async () => {
    const fetchImpl = jsonFetch(routesBody);
    await client(fetchImpl).listProducts({
      limit: 10,
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-31T00:00:00Z',
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://accensa.test/api/routes?limit=10&from=2026-08-01T00%3A00%3A00Z&to=2026-08-31T00%3A00%3A00Z',
    );
  });
});

describe('AccensaClient.fetchProduct', () => {
  it('finds a product by route path', async () => {
    const product = await client(jsonFetch(routesBody)).fetchProduct('/api/hello');
    expect(product?.id).toBe('/api/hello');
  });

  it('returns null when the route is not in the fetched window', async () => {
    const product = await client(jsonFetch(routesBody)).fetchProduct('/api/missing');
    expect(product).toBeNull();
  });
});

describe('AccensaClient — request plumbing', () => {
  it('strips a trailing slash from indexerUrl', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({ indexerUrl: 'https://accensa.test/', fetchImpl });
    await c.listOrders();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://accensa.test/api/payments');
  });

  it('sends the configured headers on every request', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({
      indexerUrl: 'https://accensa.test',
      headers: { Authorization: 'Bearer secret' },
      fetchImpl,
    });
    await c.listOrders();
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('throws AccensaAuthError with status and path on 401/403', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => new globalThis.Response(null, { status }));

      await expect(client(fetchImpl).listOrders()).rejects.toBeInstanceOf(AccensaAuthError);
      // Auth errors are still catchable as the base class.
      await expect(client(fetchImpl).listOrders()).rejects.toBeInstanceOf(AccensaError);
      await expect(client(fetchImpl).listOrders()).rejects.toMatchObject({
        status,
        path: '/api/payments',
      });
    }
  });

  it('throws a plain AccensaError with the status for other non-2xx responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new globalThis.Response(null, { status: 500 }),
    );

    const error = await client(fetchImpl)
      .listOrders()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccensaError);
    expect(error).not.toBeInstanceOf(AccensaAuthError);
    expect((error as AccensaError).status).toBe(500);
  });

  it('wraps a rejected fetch in AccensaNetworkError with the URL and cause', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });

    const error = await client(fetchImpl)
      .listOrders()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccensaNetworkError);
    const networkError = error as AccensaNetworkError;
    expect(networkError.url).toBe('https://accensa.test/api/payments');
    expect(String(networkError.cause)).toContain('ECONNREFUSED');
  });

  it('throws AccensaNetworkError when there is no fetch implementation', async () => {
    vi.stubGlobal('fetch', undefined);
    const c = new AccensaClient({ indexerUrl: 'https://accensa.test' });
    const error = await c.listOrders().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccensaNetworkError);
    expect(String(error)).toContain('No fetch implementation');
    vi.unstubAllGlobals();
  });

  it('throws AccensaContractError when a malformed row comes back', async () => {
    const fetchImpl = jsonFetch({ payments: [{ amount: '1000' }] });
    const error = await client(fetchImpl)
      .listOrders()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccensaContractError);
    expect((error as AccensaContractError).index).toBe(0);
    expect(String(error)).toContain('row at index 0');
  });

  it('throws AccensaContractError when the indexer returns a non-JSON body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new globalThis.Response('<html>not json</html>', { status: 200 }),
    );

    const error = await client(fetchImpl)
      .listOrders()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccensaContractError);
    expect(String(error)).toContain('non-JSON');
  });
});

describe('AccensaClient — rate limit handling (#155)', () => {
  it('retries a 429 with the server-provided Retry-After and succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      fetchImpl.mockResolvedValueOnce(
        new globalThis.Response(null, { status: 429, headers: { 'Retry-After': '1' } }),
      );
      fetchImpl.mockResolvedValueOnce(jsonFetch(paymentsBody)());

      const c = client(fetchImpl);
      const pending = c.listOrders();
      await vi.advanceTimersByTimeAsync(1_000);
      const page = await pending;

      expect(page.orders).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws AccensaRateLimitError with retryAfterMs when a 429 persists', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(
        async () =>
          new globalThis.Response(null, {
            status: 429,
            headers: { 'Retry-After': '2' },
          }),
      );

      const c = client(fetchImpl);
      const pending = c.listOrders();
      // Attach a catch handler up front so the rejection is not "unhandled"
      // while the fake-timer loop advances; the awaited `.catch` below still
      // observes the same error.
      const result = pending.catch((e: unknown) => e);
      // 3 retries at 2s, 2s, 2s (Retry-After each time).
      for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(2_000);
      const error = await result;

      expect(error).toBeInstanceOf(AccensaRateLimitError);
      const rateError = error as AccensaRateLimitError;
      expect(rateError.status).toBe(429);
      expect(rateError.path).toBe('/api/payments');
      expect(rateError.retryAfterMs).toBe(2000);
      // A rate limit is still catchable as the base class.
      expect(error).toBeInstanceOf(AccensaError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours a Retry-After expressed as an HTTP-date', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const later = new Date(Date.now() + 5_000).toUTCString();
      fetchImpl.mockResolvedValueOnce(
        new globalThis.Response(null, { status: 429, headers: { 'Retry-After': later } }),
      );
      fetchImpl.mockResolvedValueOnce(jsonFetch(paymentsBody)());

      const c = client(fetchImpl);
      const pending = c.listOrders();
      await vi.advanceTimersByTimeAsync(5_000);
      const page = await pending;

      expect(page.orders).toHaveLength(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AccensaClient — read caching (#160)', () => {
  it('serves repeat reads from cache without a second network call', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({ indexerUrl: 'https://accensa.test', fetchImpl });

    const first = await c.listOrders();
    const second = await c.listOrders();

    expect(first.orders).toHaveLength(2);
    expect(second.orders).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches distinct query strings separately', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({ indexerUrl: 'https://accensa.test', fetchImpl });

    await c.listOrders({ limit: 25 });
    await c.listOrders({ limit: 50 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache via clearCache', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({ indexerUrl: 'https://accensa.test', fetchImpl });

    await c.listOrders();
    c.clearCache();
    await c.listOrders();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refetches after the cache TTL expires', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = jsonFetch(paymentsBody);
      const c = new AccensaClient({
        indexerUrl: 'https://accensa.test',
        fetchImpl,
        cacheTtlMs: 100,
      });

      await c.listOrders();
      await c.listOrders();
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(150);
      await c.listOrders();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache when cacheTtlMs is 0', async () => {
    const fetchImpl = jsonFetch(paymentsBody);
    const c = new AccensaClient({
      indexerUrl: 'https://accensa.test',
      fetchImpl,
      cacheTtlMs: 0,
    });

    await c.listOrders();
    await c.listOrders();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed reads', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new globalThis.Response(null, { status: 500 }),
    );
    const c = new AccensaClient({
      indexerUrl: 'https://accensa.test',
      fetchImpl,
      cacheTtlMs: 1000,
    });

    await c.listOrders().catch(() => {});
    await c.listOrders().catch(() => {});

    // Every attempt must hit the network — an error is never served from cache.
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
