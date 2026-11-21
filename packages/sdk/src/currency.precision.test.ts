/**
 * Precision tests for formatPrice / formatPriceWithSymbol.
 *
 * The two large-amount cases must fail on the original implementation, which
 * passes the amount through parseFloat: 900719925.4740992 and 900719925.4740993
 * are exactly one stroop apart but collapse to the same IEEE 754 double (2^53),
 * so today's code formats them identically. The bigint path introduced by the
 * fix distinguishes them.
 */
import { describe, it, expect } from 'vitest';
import { formatPrice, formatPriceWithSymbol } from './currency';

describe('formatPrice – bigint precision above 2^53 stroops', () => {
  it('distinguishes adjacent stroop values that collapse to the same double', () => {
    const a = formatPrice('900719925.4740992');
    const b = formatPrice('900719925.4740993');
    expect(a).not.toBe(b);
    expect(a).toMatch(/0992$/);
    expect(b).toMatch(/0993$/);
  });

  it('keeps all seven fraction digits in the bigint path', () => {
    expect(formatPrice('900719925.4740993')).toBe('900,719,925.4740993');
    expect(formatPrice('900719925.4740992')).toBe('900,719,925.4740992');
  });

  it('ordinary amounts below the threshold are unchanged', () => {
    expect(formatPrice('1234567.8912345', 7)).toBe('1,234,567.8912345');
    expect(formatPrice('0.5')).toBe('0.5');
    expect(formatPrice('n/a')).toBe('n/a');
  });

  it('formatPriceWithSymbol appends symbol after precise digits', () => {
    expect(formatPriceWithSymbol('900719925.4740993', 7, 'USDC')).toBe('900,719,925.4740993 USDC');
  });

  it('handles a negative amount in the bigint path', () => {
    const result = formatPrice('-900719925.4740993');
    expect(result).toMatch(/^-900,719,925\./);
    expect(result).toMatch(/0993$/);
  });

  it('honours a decimals value other than 7', () => {
    // With decimals=4 the 7-digit fraction 4740993 rounds the 5th digit:
    // keep '4740', check 5th digit '9' → round up → '4741'.
    const result = formatPrice('900719925.4740993', 4);
    expect(result).toMatch(/^900,719,925\.\d{4}$/);
  });
});
