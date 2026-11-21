import { describe, it, expect } from 'vitest';
import { formatTimestamp, toISO8601 } from './format-timestamp';

const EM_DASH = '—';

/**
 * Pins the sentinel values for invalid inputs across both helpers and asserts
 * the round-trip invariant. The pairing is load-bearing: both helpers run on
 * the same <time> element (see apps/web/src/app/dashboard/page-components.tsx)
 * and their sentinels must stay consistent so the element is never rendered
 * with a "dateTime" attribute that contradicts its text content.
 */
describe('toISO8601 — invalid-input sentinel', () => {
  it.each([
    ['not-a-date string', 'not-a-date'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['new Date(NaN)', new Date(NaN)],
  ])('returns exactly "" for %s and never throws', (_label, input) => {
    expect(() => toISO8601(input as never)).not.toThrow();
    expect(toISO8601(input as never)).toBe('');
  });
});

describe('formatTimestamp — invalid-input sentinel', () => {
  it.each([
    ['not-a-date string', 'not-a-date'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['new Date(NaN)', new Date(NaN)],
  ])('returns the em dash for %s', (_label, input) => {
    expect(formatTimestamp(input as never)).toBe(EM_DASH);
  });
});

describe('sentinel agreement', () => {
  it.each([
    ['not-a-date string', 'not-a-date'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['new Date(NaN)', new Date(NaN)],
  ])(
    'toISO8601 returns "" while formatTimestamp returns em dash for %s — sentinels are paired',
    (_label, input) => {
      expect(toISO8601(input as never)).toBe('');
      expect(formatTimestamp(input as never)).toBe(EM_DASH);
    },
  );
});

describe('toISO8601 — valid round-trip', () => {
  const knownDate = new Date('2026-03-04T23:20:00.000Z');

  it('toISO8601(0) ends in .000Z (epoch origin)', () => {
    expect(toISO8601(0)).toMatch(/\.000Z$/);
  });

  it('round-trips: formatTimestamp(toISO8601(date)) equals formatTimestamp(date)', () => {
    const iso = toISO8601(knownDate);
    expect(iso).not.toBe('');
    expect(formatTimestamp(iso)).toBe(formatTimestamp(knownDate));
  });

  it('round-trips by epoch milliseconds, not by string slicing', () => {
    const ms = knownDate.getTime();
    const viaISO = new Date(toISO8601(knownDate)).getTime();
    expect(viaISO).toBe(ms);
  });
});
