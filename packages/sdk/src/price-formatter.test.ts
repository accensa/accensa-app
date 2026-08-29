import { describe, it, expect } from 'vitest';
import {
  toStroops,
  fromStroops,
  formatPrice,
  formatPriceCompact,
  assetSymbol,
  TOKENS,
} from './price-formatter';

describe('toStroops / fromStroops', () => {
  it('round-trips a 7-decimal amount', () => {
    expect(toStroops('12.5000000')).toBe(125_000_000n);
    expect(fromStroops(125_000_000n)).toBe('12.5000000');
  });

  it('handles a bare integer', () => {
    expect(toStroops('5')).toBe(50_000_000n);
  });

  it('pads short fractions rather than misreading them', () => {
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

  it('returns null for unparseable input', () => {
    expect(toStroops('abc')).toBeNull();
    expect(toStroops('')).toBeNull();
  });
});

describe('formatPrice', () => {
  it('formats XLM with symbol', () => {
    expect(formatPrice('12500000', 'native')).toBe('1.25 XLM');
  });

  it('formats USDC with symbol', () => {
    expect(formatPrice('10000000', 'USDC')).toBe('1.00 USDC');
  });

  it('groups thousands', () => {
    expect(formatPrice('12345678000000', 'native')).toBe('1,234,567.80 XLM');
  });

  it('handles small amounts with many decimals', () => {
    expect(formatPrice('1', 'native')).toBe('0.0000001 XLM');
  });

  it('returns input unchanged when unparseable', () => {
    expect(formatPrice('n/a', 'native')).toBe('n/a');
  });

  it('defaults to XLM when no asset provided', () => {
    expect(formatPrice('10000000')).toBe('1.00 XLM');
  });

  it('handles unknown assets by using the asset code as symbol', () => {
    expect(formatPrice('50000000', 'BTC:GA...')).toBe('5.00 BTC');
  });
});

describe('formatPriceCompact', () => {
  it('formats without symbol', () => {
    expect(formatPriceCompact('12500000')).toBe('1.25');
  });

  it('groups thousands', () => {
    expect(formatPriceCompact('12345678000000')).toBe('1,234,567.80');
  });

  it('returns input unchanged when unparseable', () => {
    expect(formatPriceCompact('n/a')).toBe('n/a');
  });
});

describe('assetSymbol', () => {
  it('maps native to XLM', () => {
    expect(assetSymbol('native')).toBe('XLM');
  });

  it('maps null to XLM', () => {
    expect(assetSymbol(null)).toBe('XLM');
  });

  it('extracts the code from a SEP-11 identifier', () => {
    expect(assetSymbol('USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN')).toBe('USDC');
  });
});

describe('TOKENS', () => {
  it('defines native and USDC', () => {
    expect(TOKENS.native.symbol).toBe('XLM');
    expect(TOKENS.USDC.symbol).toBe('USDC');
  });
});
