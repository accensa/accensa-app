import { describe, expect, it, vi, afterEach } from 'vitest';
import { createEvent, formatAmount } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEvent', () => {
  it('returns the type, payload and source it was given', () => {
    const event = createEvent('merchant:navigate', { path: '/payments' }, 'shell');
    expect(event.type).toBe('merchant:navigate');
    expect(event.payload).toEqual({ path: '/payments' });
    expect(event.source).toBe('shell');
  });

  it('stamps a numeric timestamp, readable as a date', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_772_000_000_000);
    const event = createEvent('ping', null, 'remote');
    expect(typeof event.timestamp).toBe('number');
    expect(event.timestamp).toBe(1_772_000_000_000);
    expect(Number.isNaN(new Date(event.timestamp).getTime())).toBe(false);
  });

  it('keeps distinct payloads per call', () => {
    const payload = { amount: '5' };
    const first = createEvent('a', payload, 'one');
    const second = createEvent('b', { amount: '6' }, 'two');
    expect(first.payload).toBe(payload);
    expect(second.payload).not.toBe(payload);
  });
});

describe('formatAmount', () => {
  it('formats numeric input with two to seven fraction digits', () => {
    expect(formatAmount(1234.5)).toBe(
      (1234.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 }),
    );
  });

  it('formats string input the same as its numeric equivalent', () => {
    expect(formatAmount('1234.5')).toBe(formatAmount(1234.5));
    expect(formatAmount('42')).toBe(formatAmount(42));
  });

  it('appends the asset code when one is provided', () => {
    expect(formatAmount(10, 'USDC')).toBe(`${formatAmount(10)} USDC`);
    expect(formatAmount('10.0000000', 'XLM')).toBe(`${formatAmount(10)} XLM`);
  });

  it('omits the asset suffix when the asset is null, undefined or empty', () => {
    const bare = formatAmount(10);
    expect(formatAmount(10, null)).toBe(bare);
    expect(formatAmount(10, undefined)).toBe(bare);
    expect(formatAmount(10, '')).toBe(bare);
  });

  it('returns "0" for values that are not numbers', () => {
    expect(formatAmount('invalid')).toBe('0');
    expect(formatAmount('')).toBe('0');
    expect(formatAmount(Number.NaN)).toBe('0');
    expect(formatAmount('invalid', 'USDC')).toBe('0');
  });

  it('keeps at most seven fraction digits', () => {
    const formatted = formatAmount('0.123456789');
    const fraction = formatted.split('.')[1]?.replace(/\D/g, '') ?? '';
    expect(fraction.length).toBeLessThanOrEqual(7);
  });
});
