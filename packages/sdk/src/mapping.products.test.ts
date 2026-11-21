/**
 * Table-driven pin of productsFromResponse coercion rules.
 *
 * Covers the coercion boundary the indexer can actually cross:
 * - A numeric total_revenue (real indexer shape) throws AccensaContractError with index.
 * - A bare array is rejected (unlike ordersFromResponse, which accepts one).
 * - truncated is a strict boolean coercion: 'true' → false, true → true.
 * - next_cursor is not surfaced on the result (ProductsResponse has no cursor).
 */
import { describe, it, expect } from 'vitest';
import { AccensaContractError } from './errors';
import { productsFromResponse } from './mapping';

describe('productsFromResponse', () => {
  it('a numeric total_revenue throws AccensaContractError with the row index', () => {
    // A real indexer shape: JSON numbers instead of decimal strings in total_revenue.
    // wireString returns undefined for a number, so productFromWire returns null, and
    // productsFromResponse throws rather than dropping the row silently.
    expect(() =>
      productsFromResponse({ routes: [{ route: '/api/ping', total_revenue: 5000, calls: 3 }] }),
    ).toThrow(AccensaContractError);

    try {
      productsFromResponse({ routes: [{ route: '/api/ping', total_revenue: 5000, calls: 3 }] });
    } catch (err) {
      expect(err).toBeInstanceOf(AccensaContractError);
      expect((err as AccensaContractError).index).toBe(0);
    }
  });

  it('a bare array throws rather than returning an empty list (asymmetry with ordersFromResponse)', () => {
    // ordersFromResponse accepts a bare array; productsFromResponse does not.
    expect(() => productsFromResponse([])).toThrow(AccensaContractError);
    expect(() => productsFromResponse([])).toThrow(/routes/);
  });

  describe('truncated coercion', () => {
    const cases = [
      { name: 'string "true" → false', input: { routes: [], truncated: 'true' }, expected: false },
      { name: 'boolean true → true', input: { routes: [], truncated: true }, expected: true },
      { name: 'boolean false → false', input: { routes: [], truncated: false }, expected: false },
      { name: 'absent → false', input: { routes: [] }, expected: false },
    ] as const;

    for (const { name, input, expected } of cases) {
      it(name, () => {
        const { truncated } = productsFromResponse(input);
        expect(truncated).toBe(expected);
      });
    }
  });

  it('a stray next_cursor key is ignored — not surfaced on ProductsResponse', () => {
    const result = productsFromResponse({ routes: [], next_cursor: 'abc' });
    expect(Object.keys(result).sort()).toStrictEqual(['products', 'truncated']);
  });

  it('an empty routes array returns { products: [], truncated: false }', () => {
    const result = productsFromResponse({ routes: [] });
    expect(result).toStrictEqual({ products: [], truncated: false });
  });
});
