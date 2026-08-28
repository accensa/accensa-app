/**
 * Typed client for the Accensa indexer's read API.
 *
 * Every method returns strict {@link Order} / {@link Product} values produced
 * by the mappers in `./mapping`, so consuming the SDK gives full autocomplete
 * on the fields and strict null checks on the optional ones — no `any`, no
 * `Record<string, unknown>` escaping to the caller.
 *
 * The client talks to the same endpoints the dashboard's widgets use
 * (`GET /api/payments` for orders, `GET /api/routes` for products). Both are
 * scoped to the authenticated merchant, so a caller must attach whatever
 * credential the deployment expects (session cookie, API key, …) via
 * {@link AccensaClientOptions.headers}.
 */

import { ordersFromResponse, productsFromResponse } from './mapping';
import type { Order } from './types/order';
import type { Product } from './types/product';
import {
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
} from './errors';

// Re-exported so `import { AccensaError } from '@accensa/sdk'` keeps working and
// the classes stay available from the client module.
export {
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
} from './errors';
import type { SyncEvent } from './types/sync-event';

export interface AccensaClientOptions {
  /** Base URL of your Accensa deployment, e.g. https://accensa-dashboard.vercel.app */
  indexerUrl: string;
  /**
   * Headers added to every request. The indexer's read endpoints are scoped to
   * the signed-in merchant, so pass whatever that requires (session cookie,
   * API key, …).
   */
  headers?: Record<string, string>;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional request timeout in milliseconds. */
  timeoutMs?: number;
}

/** A page of {@link Order}s as `/api/payments` returns them. */
export interface OrdersPage {
  orders: Order[];
  /** Opaque cursor for the next page; null when the list is exhausted. */
  nextCursor: string | null;
}

/** A page of {@link Product}s as `/api/routes` returns them. */
export interface ProductsPage {
  products: Product[];
  /** Whether more product groups exist than the limit (rolled into "(other)"). */
  truncated: boolean;
}

export class AccensaClient {
  private readonly indexerUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: AccensaClientOptions) {
    this.indexerUrl = opts.indexerUrl.replace(/\/$/, '');
    this.headers = opts.headers ?? {};
    this.fetchImpl = opts.fetchImpl;
  }

  /**
   * Fetches the most recent orders, newest first.
   *
   * Mirrors `/api/payments`: `limit` (default 100, max 1000) and an opaque
   * `cursor` from a previous page's `nextCursor`.
   */
  async listOrders(opts: { limit?: number; cursor?: string } = {}): Promise<OrdersPage> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.cursor !== undefined) params.set('cursor', opts.cursor);

    const body = await this.getJson(`/api/payments${queryString(params)}`);
    return ordersFromResponse(body);
  }

  /**
   * Looks up one order by its Stellar transaction hash.
   *
   * The indexer exposes no lookup-by-hash endpoint, so this searches the most
   * recent `limit` indexed payments (default 1000, the API maximum). Returns
   * null when the order is not in that window.
   */
  async fetchOrder(orderId: string, opts: { limit?: number } = {}): Promise<Order | null> {
    const page = await this.listOrders({ limit: opts.limit ?? 1000 });
    return page.orders.find((order) => order.id === orderId) ?? null;
  }

  /**
   * Fetches the merchant's products (paid endpoints) with their indexed
   * revenue, most revenue first.
   *
   * Mirrors `/api/routes`: `limit` (default 50, max 200) and an optional
   * `from`/`to` ISO-8601 window (defaults to the last 30 days server-side).
   */
  async listProducts(
    opts: { limit?: number; from?: string; to?: string } = {},
  ): Promise<ProductsPage> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.from !== undefined) params.set('from', opts.from);
    if (opts.to !== undefined) params.set('to', opts.to);

    const body = await this.getJson(`/api/routes${queryString(params)}`);
    return productsFromResponse(body);
  }

  /**
   * Looks up one product by its route path (e.g. `/api/hello`).
   *
   * The indexer exposes no lookup-by-route endpoint, so this searches the
   * top `limit` products by revenue (default 200, the API maximum). Returns
   * null when the product is not in that window.
   */
  async fetchProduct(productId: string, opts: { limit?: number } = {}): Promise<Product | null> {
    const page = await this.listProducts({ limit: opts.limit ?? 200 });
    return page.products.find((product) => product.id === productId) ?? null;
  }

  /**
   * Subscribes to real-time indexer updates via Server-Sent Events.
   *
   * Returns an unsubscribe function. `onSync` fires each time the indexer
   * completes a run for the merchant; `onStatus` reports connection state so
   * callers can show a live/lagging indicator. Uses the browser-native
   * EventSource, which reconnects automatically.
   *
   * Mirrors the `/api/sync/stream` endpoint.
   */
  subscribeSync(handlers: {
    onSync: (payload: SyncEvent) => void;
    onStatus?: (connected: boolean) => void;
  }): () => void {
    if (typeof globalThis.EventSource !== 'function') {
      // Non-browser callers have no EventSource; degrade to a no-op.
      return () => undefined;
    }
    const source = new EventSource(`${this.indexerUrl}/api/sync/stream`);
    source.addEventListener('sync', (event) => {
      const message = event as MessageEvent;
      try {
        handlers.onSync(JSON.parse(message.data as string) as SyncEvent);
      } catch {
        // Ignore malformed payloads rather than dropping the subscription.
      }
    });
    source.onopen = () => handlers.onStatus?.(true);
    source.onerror = () => handlers.onStatus?.(false);
    return () => source.close();
  }

  private async getJson(path: string): Promise<unknown> {
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') {
      throw new AccensaNetworkError('No fetch implementation available');
    }

    const url = `${this.indexerUrl}${path}`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'GET',
        headers: this.headers,
      });
    } catch (cause) {
      throw new AccensaNetworkError(`Failed to reach the Accensa indexer at ${path}`, {
        url,
        cause,
      });
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AccensaAuthError(
          `Accensa rejected the request with ${response.status} for ${path}`,
          {
            status: response.status,
            path,
          },
        );
      }
      throw new AccensaError(`Accensa returned ${response.status} for ${path}`, {
        status: response.status,
      });
    }

    try {
      const body: unknown = await response.json();
      return body;
    } catch (cause) {
      throw new AccensaContractError(`Accensa returned a non-JSON body for ${path}`, { cause });
    }
  }
}

function queryString(params: URLSearchParams): string {
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
