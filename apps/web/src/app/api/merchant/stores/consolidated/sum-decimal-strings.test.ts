import { describe, expect, it } from 'vitest';
import { sumDecimalStrings } from './sum-decimal-strings';

describe('sumDecimalStrings', () => {
  it('returns "0" for an empty array', () => {
    expect(sumDecimalStrings([])).toBe('0');
  });

  it('sums whole numbers without a decimal point', () => {
    expect(sumDecimalStrings(['10', '20', '30'])).toBe('60');
    expect(sumDecimalStrings(['0', '0'])).toBe('0');
  });

  it('adds mixed fractional precisions exactly', () => {
    expect(sumDecimalStrings(['1.5', '2.255'])).toBe('3.755');
    expect(sumDecimalStrings(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimalStrings(['1.005', '2.005'])).toBe('3.01');
  });

  it('handles negative values and mixed signs', () => {
    expect(sumDecimalStrings(['-10.50', '5.25'])).toBe('-5.25');
    expect(sumDecimalStrings(['-1.25', '-2.25'])).toBe('-3.5');
    expect(sumDecimalStrings(['100.75', '-0.75'])).toBe('100');
  });

  it('returns "0" when the parts cancel out', () => {
    expect(sumDecimalStrings(['1.25', '-1.25'])).toBe('0');
    expect(sumDecimalStrings(['5', '-2', '-3'])).toBe('0');
  });

  it('trims trailing zeros from the fractional total', () => {
    expect(sumDecimalStrings(['1.50', '2.50'])).toBe('4');
    expect(sumDecimalStrings(['0.10', '0.20'])).toBe('0.3');
    expect(sumDecimalStrings(['1.0000001', '0.0000000'])).toBe('1.0000001');
  });

  it('keeps precision at long scale lengths', () => {
    expect(sumDecimalStrings(['0.0000001', '0.0000002'])).toBe('0.0000003');
    expect(sumDecimalStrings(['1.123456789012345678', '2.876543210987654322'])).toBe('4');
    expect(sumDecimalStrings(['9007199254740993', '1'])).toBe('9007199254740994');
  });

  it('handles leading and trailing zeros in the inputs', () => {
    expect(sumDecimalStrings(['00012', '0008'])).toBe('20');
    expect(sumDecimalStrings(['-0.0', '0'])).toBe('0');
    expect(sumDecimalStrings(['0.5', '0.5'])).toBe('1');
  });
});
