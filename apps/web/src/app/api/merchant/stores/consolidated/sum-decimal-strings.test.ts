import { describe, expect, it } from 'vitest';
import { DecimalStringError, sumDecimalStrings } from './sum-decimal-strings';

describe('sumDecimalStrings', () => {
  it.each([
    { values: ['1.10', '2.20'], expected: '3.30' },
    { values: ['1', '2.50'], expected: '3.50' },
    { values: ['1.10', '-1.10'], expected: '0.00' },
    { values: ['0.1', '0.2', '10.0001'], expected: '10.3001' },
    { values: ['-0.5', '1.25'], expected: '0.75' },
    { values: ['-1.25', '-2.50'], expected: '-3.75' },
    { values: ['100', '200'], expected: '300' },
    { values: [], expected: '0' },
  ])('sums $values to $expected and keeps the input scale', ({ values, expected }) => {
    expect(sumDecimalStrings(values)).toBe(expected);
  });

  it.each(['', '1e3', '12,50', 'abc', '1.', '.5', '--1', ' 1.00'])(
    'rejects %j with a DecimalStringError',
    (value) => {
      expect(() => sumDecimalStrings([value])).toThrow(DecimalStringError);
      try {
        sumDecimalStrings(['1.00', value]);
        throw new Error('expected DecimalStringError');
      } catch (error) {
        expect(error).toBeInstanceOf(DecimalStringError);
        expect((error as DecimalStringError).name).toBe('DecimalStringError');
        expect((error as DecimalStringError).value).toBe(value);
      }
    },
  );

  it('preserves precision beyond the safe integer range', () => {
    expect(sumDecimalStrings(['9007199254740993.01', '0.09'])).toBe('9007199254740993.10');
  });
});
