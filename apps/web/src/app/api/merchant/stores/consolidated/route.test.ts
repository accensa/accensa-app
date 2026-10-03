import { describe, expect, it } from 'vitest';
import { sumDecimalStrings } from './sum-decimal-strings';

describe('sumDecimalStrings', () => {
  it('adds decimal values without floating-point precision loss', () => {
    expect(sumDecimalStrings(['0.1', '0.2', '10.0001'])).toBe('10.3001');
    expect(sumDecimalStrings(['1', '2.50'])).toBe('3.5');
    expect(sumDecimalStrings(['-0.5', '1.25'])).toBe('0.75');
  });
});
