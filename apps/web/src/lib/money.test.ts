import { describe, it, expect } from 'vitest';
import { toStroops, fromStroops, sumAmounts, formatAmount, assetLabel } from './money';

describe('toStroops / fromStroops', () => {
  it('round-trips a 7-decimal amount', () => {
    expect(toStroops('12.5000000')).toBe(125_000_000n);
    expect(fromStroops(125_000_000n)).toBe('12.5000000');
  });

  it('handles a bare integer', () => {
    expect(toStroops('5')).toBe(50_000_000n);
  });

  it('pads short fractions rather than misreading them', () => {
    // "0.1" is one tenth, not one stroop.
    expect(toStroops('0.1')).toBe(1_000_000n);
  });

  it('preserves a single stroop', () => {
    expect(toStroops('0.0000001')).toBe(1n);
    expect(fromStroops(1n)).toBe('0.0000001');
  });

  it('handles negatives', () => {
    expect(toStroops('-2.5')).toBe(-25_000_000n);
    expect(fromStroops(-25_000_000n)).toBe('-2.5000000');
  });

  it('returns null for unparseable input instead of NaN', () => {
    expect(toStroops('abc')).toBeNull();
    expect(toStroops('')).toBeNull();
  });
});

describe('sumAmounts', () => {
  it('sums exactly where floats would not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3000000');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('sums a realistic ledger', () => {
    expect(sumAmounts(['12.5000000', '24.5000000', '500.0000000'])).toBe('537.0000000');
  });

  it('is exact across many small amounts, where float accumulation drifts', () => {
    const dust = Array(100_000).fill('0.0000001');
    expect(sumAmounts(dust)).toBe('0.0100000');

    // The same accumulation in floating point does not land on the exact value.
    const viaFloat = dust.reduce((acc, v) => acc + Number(v), 0);
    expect(viaFloat).not.toBe(0.01);
  });

  it('skips unparseable entries rather than poisoning the total', () => {
    expect(sumAmounts(['1.0', 'oops', '2.0'])).toBe('3.0000000');
  });

  it('returns zero for an empty ledger', () => {
    expect(sumAmounts([])).toBe('0.0000000');
  });
});

describe('formatAmount', () => {
  it('trims trailing zeros but keeps a minimum', () => {
    expect(formatAmount('12.5000000')).toBe('12.50');
    expect(formatAmount('100.0000000')).toBe('100.00');
  });

  it('keeps meaningful precision beyond the minimum', () => {
    expect(formatAmount('0.0000001')).toBe('0.0000001');
    expect(formatAmount('1.2345678')).toBe('1.2345678');
  });

  it('groups thousands', () => {
    expect(formatAmount('1234567.8900000')).toBe('1,234,567.89');
  });

  it('does not corrupt amounts beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '9007199254740993.0000000';
    expect(formatAmount(huge)).toBe('9,007,199,254,740,993.00');
  });

  it('returns the input unchanged when unparseable', () => {
    expect(formatAmount('n/a')).toBe('n/a');
  });
});

describe('assetLabel', () => {
  it('maps native to XLM', () => {
    expect(assetLabel('native')).toBe('XLM');
    expect(assetLabel(null)).toBe('XLM');
  });

  it('takes the code from a SEP-11 identifier', () => {
    expect(assetLabel('USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')).toBe('USDC');
  });
});
