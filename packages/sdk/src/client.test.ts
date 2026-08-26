import { describe, it, expect, vi } from 'vitest';
import {
  AccensaClient,
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
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
