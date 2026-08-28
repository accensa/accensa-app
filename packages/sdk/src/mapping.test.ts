import { describe, it, expect } from 'vitest';
import { AccensaContractError } from './errors';
import {
  orderFromWire,
  ordersFromResponse,
  productFromWire,
  productsFromResponse,
} from './mapping';

describe('orderFromWire', () => {
  it('maps a full payment row onto a strict Order', () => {
    const order = orderFromWire({
      tx_hash: 'a'.repeat(64),
      route: '/api/hello',
      method: 'GET',
      payer: 'G' + 'A'.repeat(55),
      amount: '1000',
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ledger: 42,
      ts: '2026-08-20T07:22:16Z',
      metadata: { tier: 'premium' },
    });

    expect(order).toEqual({
      id: 'a'.repeat(64),
      productId: '/api/hello',
      method: 'GET',
      payer: 'G' + 'A'.repeat(55),
      amount: '1000',
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ledger: 42,
      createdAt: '2026-08-20T07:22:16Z',
      metadata: { tier: 'premium' },
    });
  });

  it('normalises null optional columns to undefined, never null', () => {
    const order = orderFromWire({
      tx_hash: 'a'.repeat(64),
      route: null,
      method: null,
      payer: null,
      asset: null,
      ledger: null,
      ts: '2026-08-20T07:22:16Z',
      amount: '1000',
      metadata: null,
    });

    expect(order).toEqual({
      id: 'a'.repeat(64),
      amount: '1000',
      createdAt: '2026-08-20T07:22:16Z',
      productId: undefined,
      asset: undefined,
      payer: undefined,
      method: undefined,
      ledger: undefined,
      metadata: undefined,
    });
    // Strict null checks: optional fields are `undefined`, not `null`.
    expect(order?.metadata).toBeUndefined();
    expect(order?.productId).toBeUndefined();
  });

  it('returns null for a row missing a required field', () => {
    expect(orderFromWire({ tx_hash: 'a'.repeat(64), ts: '2026-08-20T07:22:16Z' })).toBeNull();
    expect(orderFromWire({ tx_hash: 'a'.repeat(64), amount: '1000' })).toBeNull();
    expect(orderFromWire({ amount: '1000', ts: '2026-08-20T07:22:16Z' })).toBeNull();
  });

  it('returns null for anything that is not a record', () => {
    expect(orderFromWire(null)).toBeNull();
    expect(orderFromWire('tx_hash')).toBeNull();
    expect(orderFromWire(['not', 'a', 'row'])).toBeNull();
    expect(orderFromWire(undefined)).toBeNull();
  });
});

describe('ordersFromResponse', () => {
  it('parses the payments envelope into orders and the next cursor', () => {
    const { orders, nextCursor } = ordersFromResponse({
      payments: [
        {
          tx_hash: 'a'.repeat(64),
          amount: '1000',
          ts: '2026-08-20T07:22:16Z',
          route: '/api/hello',
        },
      ],
      next_cursor: 'c2VsbGluZy1jYW5k',
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ id: 'a'.repeat(64), productId: '/api/hello' });
    expect(nextCursor).toBe('c2VsbGluZy1jYW5k');
  });

  it('treats a missing next_cursor as an exhausted list', () => {
    const { nextCursor } = ordersFromResponse({ payments: [] });
    expect(nextCursor).toBeNull();
  });

  it('throws AccensaContractError on a malformed row rather than dropping it', () => {
    try {
      ordersFromResponse({
        payments: [
          { tx_hash: 'a'.repeat(64), amount: '1000', ts: '2026-08-20T07:22:16Z' },
          { amount: '1000', ts: '2026-08-20T07:22:16Z' }, // no tx_hash
        ],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AccensaContractError);
      expect((error as AccensaContractError).index).toBe(1);
      expect(String(error)).toContain('row at index 1');
    }
  });

  it('throws AccensaContractError when the body is not a payments envelope', () => {
    expect(() => ordersFromResponse({ payments: 'nope' })).toThrow(AccensaContractError);
    expect(() => ordersFromResponse({ payments: 'nope' })).toThrow(/payments/);
    expect(() => ordersFromResponse([])).toThrow(AccensaContractError);
    expect(() => ordersFromResponse(null)).toThrow(AccensaContractError);
  });
});

describe('productFromWire', () => {
  it('maps a route aggregate onto a strict Product', () => {
    const product = productFromWire({
      route: '/api/hello',
      method: 'GET',
      total_revenue: '5000',
      calls: 5,
      metadata: { tier: 'premium' },
    });

    expect(product).toEqual({
      id: '/api/hello',
      method: 'GET',
      totalRevenue: '5000',
      calls: 5,
      metadata: { tier: 'premium' },
    });
  });

  it('normalises a null method to undefined', () => {
    const product = productFromWire({
      route: '/api/hello',
      method: null,
      total_revenue: '5000',
      calls: 5,
    });
    expect(product?.method).toBeUndefined();
    expect(product).toEqual({
      id: '/api/hello',
      method: undefined,
      totalRevenue: '5000',
      calls: 5,
      metadata: undefined,
    });
  });

  it('returns null when a required field is missing or mistyped', () => {
    expect(productFromWire({ route: '/api/hello', total_revenue: '5000' })).toBeNull(); // no calls
    expect(productFromWire({ route: '/api/hello', calls: 5 })).toBeNull(); // no revenue
    expect(productFromWire({ total_revenue: '5000', calls: 5 })).toBeNull(); // no route
    expect(productFromWire({ route: '/api/hello', total_revenue: '5000', calls: '5' })).toBeNull(); // calls as string
  });
});

describe('productsFromResponse', () => {
  it('parses the routes envelope into products and the truncation flag', () => {
    const { products, truncated } = productsFromResponse({
      routes: [{ route: '/api/hello', total_revenue: '5000', calls: 5 }],
      truncated: true,
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: '/api/hello', calls: 5 });
    expect(truncated).toBe(true);
  });

  it('defaults truncated to false when absent', () => {
    const { truncated } = productsFromResponse({ routes: [] });
    expect(truncated).toBe(false);
  });

  it('throws AccensaContractError on a malformed row', () => {
    try {
      productsFromResponse({
        routes: [{ route: '/api/hello', calls: 5 }],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AccensaContractError);
      expect((error as AccensaContractError).index).toBe(0);
      expect(String(error)).toContain('row at index 0');
    }
  });

  it('throws AccensaContractError when the body is not a routes envelope', () => {
    expect(() => productsFromResponse({ routes: 'nope' })).toThrow(AccensaContractError);
    expect(() => productsFromResponse({ routes: 'nope' })).toThrow(/routes/);
    expect(() => productsFromResponse(null)).toThrow(AccensaContractError);
  });
});
