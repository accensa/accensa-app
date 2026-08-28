/**
 * Strict mappers from the indexer's wire rows to the SDK's Order/Product types.
 *
 * The indexer publishes payment rows decoded from Soroban `transfer` XDR events,
 * and route aggregates derived from them (see `apps/web/src/app/api/payments`
 * and `/api/routes`). These mappers close the last gap: a JSON response — typed
 * as `unknown` until here — becomes a fully typed `Order` or `Product`, with
 * `null` optional columns normalised to `undefined` so consumers get real strict
 * null checks instead of `Record<string, unknown>`.
 *
 * The single-row mappers (`orderFromWire`, `productFromWire`) return `null` for
 * anything unreadable, matching the defensive style of `parseSettlementHeader`.
 * The response mappers (`ordersFromResponse`, `productsFromResponse`) are
 * strict: one malformed row throws rather than being silently dropped, because
 * a page that silently loses rows would mislead a merchant about their ledger.
 */

import { AccensaContractError } from './errors';
import type { Order, OrderMetadata } from './types/order';
import type { Product, ProductMetadata } from './types/product';

/** True for plain objects — the only thing the mappers accept as a row. */
export function isWireRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a string column, treating missing, null, and empty as undefined. */
export function wireString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function wireMetadata(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return isWireRecord(record.metadata) ? (record.metadata as Record<string, unknown>) : undefined;
}

/**
 * Maps one payment row to a strict {@link Order}.
 *
 * Accepts the snake-cased shape `/api/payments` publishes (`tx_hash`, `route`,
 * `amount`, `asset`, `payer`, `method`, `ledger`, `ts`, `metadata`). Returns
 * null when the row is not a record or lacks a required field (`tx_hash`,
 * `amount`, `ts`).
 */
export function orderFromWire(raw: unknown): Order | null {
  if (!isWireRecord(raw)) return null;

  const id = wireString(raw, 'tx_hash');
  const amount = wireString(raw, 'amount');
  const createdAt = wireString(raw, 'ts');
  if (!id || !amount || !createdAt) return null;

  const ledger = raw.ledger;
  const metadata = wireMetadata(raw) as OrderMetadata | undefined;

  return {
    id,
    amount,
    createdAt,
    productId: wireString(raw, 'route'),
    asset: wireString(raw, 'asset'),
    payer: wireString(raw, 'payer'),
    method: wireString(raw, 'method'),
    ledger: typeof ledger === 'number' ? ledger : undefined,
    metadata,
  };
}

/** The result of parsing a `/api/payments` response body. */
export interface OrdersResponse {
  orders: Order[];
  /** Opaque cursor for the next page; null when the list is exhausted. */
  nextCursor: string | null;
}

/**
 * Maps a `/api/payments` response body to a strict `{ orders, nextCursor }`.
 *
 * Accepts either the envelope (`{ payments: [...], next_cursor }`) or a bare
 * array of payment rows. Throws on a malformed row — a payment that cannot be
 * mapped is a contract violation worth surfacing, not a row to silently drop.
 */
export function ordersFromResponse(raw: unknown): OrdersResponse {
  if (!isWireRecord(raw)) {
    throw new AccensaContractError(
      'ordersFromResponse: expected an object with a "payments" array',
    );
  }
  const rows = Array.isArray(raw.payments) ? raw.payments : null;
  if (rows === null) {
    throw new AccensaContractError('ordersFromResponse: expected a "payments" array');
  }

  const orders: Order[] = rows.map((row, index) => {
    const order = orderFromWire(row);
    if (!order) {
      throw new AccensaContractError(
        `ordersFromResponse: row at index ${index} is missing a required field ` +
          '(tx_hash, amount, ts)',
        { index },
      );
    }
    return order;
  });

  const nextCursor = wireString(raw, 'next_cursor') ?? null;
  return { orders, nextCursor };
}

/**
 * Maps one route-aggregate row to a strict {@link Product}.
 *
 * Accepts the snake-cased shape `/api/routes` publishes (`route`, `method`,
 * `total_revenue`, `calls`, `metadata`). Returns null when the row is not a
 * record or lacks a required field (`route`, `total_revenue`, `calls`).
 */
export function productFromWire(raw: unknown): Product | null {
  if (!isWireRecord(raw)) return null;

  const id = wireString(raw, 'route');
  const totalRevenue = wireString(raw, 'total_revenue');
  if (!id || !totalRevenue || typeof raw.calls !== 'number') return null;

  const metadata = wireMetadata(raw) as ProductMetadata | undefined;

  return {
    id,
    totalRevenue,
    calls: raw.calls,
    method: wireString(raw, 'method'),
    metadata,
  };
}

/** The result of parsing a `/api/routes` response body. */
export interface ProductsResponse {
  products: Product[];
  /** Whether more product groups exist than the limit (rolled into "(other)"). */
  truncated: boolean;
}

/**
 * Maps a `/api/routes` response body to a strict `{ products, truncated }`.
 *
 * Throws on a malformed row, mirroring {@link ordersFromResponse}.
 */
export function productsFromResponse(raw: unknown): ProductsResponse {
  if (!isWireRecord(raw) || !Array.isArray(raw.routes)) {
    throw new AccensaContractError(
      'productsFromResponse: expected an object with a "routes" array',
    );
  }

  const products: Product[] = raw.routes.map((row, index) => {
    const product = productFromWire(row);
    if (!product) {
      throw new AccensaContractError(
        `productsFromResponse: row at index ${index} is missing a required field ` +
          '(route, total_revenue, calls)',
        { index },
      );
    }
    return product;
  });

  const truncated = typeof raw.truncated === 'boolean' ? raw.truncated : false;
  return { products, truncated };
}
