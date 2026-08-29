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
import { fetchWithRetry, HttpError, retryAfterMs, type RetryOptions } from '../retry';
import type { Order } from './types/order';
import type { Product } from './types/product';
import type { SyncEvent } from './types/sync-event';

// Re-exported from `./errors` (which owns the canonical definitions) so that
// consumers importing the error classes from `@accensa/sdk` keep working.
export {
  AccensaError,
  AccensaAuthError,
  AccensaContractError,
  AccensaNetworkError,
  AccensaRateLimitError,
  AccensaTimeoutError,
} from './errors';
import {
  AccensaError,
  AccensaAuthError,
  AccensaContractError,
  AccensaNetworkError,
  AccensaRateLimitError,
  AccensaTimeoutError,
} from './errors';

/** Default request timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How long a successful read stays in the in-memory cache before being
 * re-fetched, in milliseconds.
 *
 * The dashboard navigates between pages that each re-read the same merchant
 * profile and product data. A short TTL (10 seconds) makes those repeat reads
 * instant while keeping the cache stale for at most one polling interval, so
 * it can never outlive the truth for long. Set `cacheTtlMs: 0` to disable.
 */
const DEFAULT_CACHE_TTL_MS = 10_000;

/** How many times a rate-limited (429) request is retried after the first try. */
const RATE_LIMIT_MAX_RETRIES = 3;

export interface AccensaClientOptions {
  /** Base URL of your Accensa deployment, e.g. https://accensa-dashboard.vercel.app */
  indexerUrl: string;
  /**
   * Headers added to every request. The indexer's read endpoints are scoped to
   * the signed-in merchant, so pass whatever that requires (session cookie,
   * API key, …).
   */
  headers?: Record<string, string>;
  /**
   * Request timeout in milliseconds. Applies to every HTTP request made by
   * the client. Set to 0 to disable the timeout entirely. (#134)
   *
   * Defaults to 30 000 ms (30 seconds).
   */
  timeoutMs?: number;
  /**
   * How long successful read results are served from an in-memory cache, in
   * milliseconds (#160). Repeat calls for the same data within the TTL bypass
   * the network. Set to 0 to disable caching. Defaults to 10 000 ms.
   */
  cacheTtlMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
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
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchImpl?: typeof fetch;
  /** In-memory read cache (#160): keyed by path, entries expire on their TTL. */
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(opts: AccensaClientOptions) {
    this.indexerUrl = opts.indexerUrl.replace(/\/$/, '');
    this.headers = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fetchImpl = opts.fetchImpl;
  }

  /**
   * Drops every cached read, forcing the next call to hit the network.
   *
   * Call this after a write the cache could have missed (a refund, a profile
   * update, a manual sync) so the dashboard never shows data that predates it.
   */
  clearCache(): void {
    this.cache.clear();
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
        const payload = JSON.parse(message.data as string) as SyncEvent;
        // A new sync run means fresh data on the other side of every cached
        // read; drop the cache so the next poll reflects it (#160).
        this.clearCache();
        handlers.onSync(payload);
      } catch {
        // Ignore malformed payloads rather than dropping the subscription.
      }
    });
    source.onopen = () => handlers.onStatus?.(true);
    source.onerror = () => handlers.onStatus?.(false);
    return () => source.close();
  }

  /**
   * Makes a GET request and parses the JSON response, respecting the
   * configured timeout (#134), retrying rate limits (#155), and serving
   * recent reads from the in-memory cache (#160).
   *
   * Read results are cached by path for `cacheTtlMs`, so the redundant reads
   * the dashboard makes across page navigations resolve instantly; expiry and
   * {@link clearCache} bound how stale a hit can be. A request that never
   * succeeds is never cached.
   */
  private async getJson(path: string): Promise<unknown> {
    const cached = this.cacheRead(path);
    if (cached.hit) return cached.value;

    const doFetch = this.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') {
      throw new AccensaNetworkError('No fetch implementation available');
    }

    const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;

    let response: Response;
    try {
      response = await fetchWithRetry(`${this.indexerUrl}${path}`, {
        method: 'GET',
        headers: this.headers,
        signal,
      }, {
        fetchImpl: doFetch,
        retryOn429: true,
        maxRetries: RATE_LIMIT_MAX_RETRIES,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AccensaTimeoutError(`Request to ${path} timed out after ${this.timeoutMs}ms`);
      }
      if (err instanceof HttpError && err.status === 429) {
        // fetchWithRetry already waited between attempts; if the node is still
        // limiting us the caller needs a concrete signal, not a generic error.
        throw new AccensaRateLimitError(`Accensa is rate limited for ${path}`, {
          path,
          retryAfterMs: retryAfterMs(err.response),
        });
      }
      if (err instanceof HttpError) {
        if (err.status === 401 || err.status === 403) {
          throw new AccensaAuthError(
            `Accensa rejected the request with ${err.status} for ${path}`,
            { status: err.status, path },
          );
        }
        throw new AccensaError(`Accensa returned ${err.status} for ${path}`, {
          status: err.status,
        });
      }
      // fetchWithRetry rethrows the underlying error once retries are spent.
      // Wrap it so the SDK's error surface stays typed.
      throw new AccensaNetworkError(`Request to ${path} failed`, {
        url: `${this.indexerUrl}${path}`,
        cause: err,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new AccensaContractError(`Accensa returned a non-JSON body for ${path}`, { cause });
    }

    this.storeCache(path, body);
    return body;
  }

  /** Returns a cached read for `path` when one exists and is still fresh. */
  private cacheRead(path: string): { hit: boolean; value?: unknown } {
    if (this.cacheTtlMs <= 0) return { hit: false };
    const entry = this.cache.get(path);
    if (!entry) return { hit: false };
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(path);
      return { hit: false };
    }
    return { hit: true, value: entry.value };
  }

  private storeCache(path: string, value: unknown): void {
    if (this.cacheTtlMs <= 0) return;
    this.cache.set(path, { expiresAt: Date.now() + this.cacheTtlMs, value });
  }
}

/** Extra retry knobs exposed for callers who reuse the rate-limit wrapper directly. */
export type { RetryOptions };

function queryString(params: URLSearchParams): string {
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
