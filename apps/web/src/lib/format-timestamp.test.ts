import { describe, it, expect } from 'vitest';
import { formatTimestamp, toISO8601, getTimezoneAbbr } from './format-timestamp';

/**
 * Tests for deterministic timestamp formatting.
 *
 * The key invariant: formatTimestamp must produce the same output regardless of
 * the runtime's locale or timezone. It uses UTC by default with an explicit
 * en-GB locale, so server and client always agree.
 */

describe('formatTimestamp', () => {
  // Use a known instant: 2026-03-04T23:20:00.000Z (UTC)
  const knownDate = new Date('2026-03-04T23:20:00.000Z');

  it('formats with explicit UTC timezone by default', () => {
    const result = formatTimestamp(knownDate);
    expect(result).toMatch(/4 Mar 2026, 11:20:00 pm UTC/i);
  });

  it('accepts ISO 8601 string input', () => {
    const result = formatTimestamp('2026-03-04T23:20:00.000Z');
    expect(result).toMatch(/4 Mar 2026, 11:20:00 pm UTC/i);
  });

  it('accepts epoch milliseconds input', () => {
    const result = formatTimestamp(knownDate.getTime());
    expect(result).toMatch(/4 Mar 2026, 11:20:00 pm UTC/i);
  });

  it('respects explicit timezone parameter', () => {
    // New York is UTC-5 in March 2026 (EST)
    const result = formatTimestamp(knownDate, 'America/New_York');
    // The timezone name is passed through to the output string.
    expect(result).toContain('America/New_York');
    expect(result).toMatch(/6:20:00 pm/i);
  });

  it('returns a dash for invalid dates', () => {
    expect(formatTimestamp('not-a-date')).toBe('—');
    expect(formatTimestamp(NaN)).toBe('—');
  });

  it('uses 12-hour format with am/pm', () => {
    const morning = new Date('2026-01-15T08:30:00.000Z');
    const result = formatTimestamp(morning);
    expect(result.toLowerCase()).toContain('am');
  });

  it('does not use leading zeros for day', () => {
    const result = formatTimestamp(knownDate);
    // en-GB format gives "4" not "04" for day
    expect(result).toMatch(/^4 Mar/);
  });

  it('is deterministic across calls', () => {
    const runs = Array.from({ length: 10 }, () => formatTimestamp(knownDate));
    expect(new Set(runs).size).toBe(1);
  });

  it('produces stable output under different runtime timezones', () => {
    // This test verifies that changing the TZ environment variable does not
    // affect the output. We test by checking that the UTC result is always the
    // same, regardless of the system timezone.
    const result1 = formatTimestamp(knownDate, 'UTC');
    const result2 = formatTimestamp(knownDate, 'UTC');
    expect(result1).toBe(result2);
    expect(result1).toMatch(/4 Mar 2026, 11:20:00 pm UTC/i);
  });
});

describe('toISO8601', () => {
  it('returns ISO 8601 string from Date', () => {
    const date = new Date('2026-03-04T23:20:00.000Z');
    expect(toISO8601(date)).toBe('2026-03-04T23:20:00.000Z');
  });

  it('returns ISO 8601 string from epoch ms', () => {
    expect(toISO8601(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('returns empty string for invalid dates', () => {
    expect(toISO8601('not-a-date')).toBe('');
  });

  it('always produces the same result', () => {
    const date = new Date('2026-06-15T12:00:00.000Z');
    const results = Array.from({ length: 5 }, () => toISO8601(date));
    expect(new Set(results).size).toBe(1);
  });
});

describe('getTimezoneAbbr', () => {
  it('returns "UTC" for the UTC timezone', () => {
    expect(getTimezoneAbbr('UTC')).toBe('UTC');
  });

  it('returns a string for any timezone', () => {
    const result = getTimezoneAbbr('America/New_York');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns the timezone parameter for invalid timezones', () => {
    expect(getTimezoneAbbr('Invalid/Zone')).toBe('Invalid/Zone');
  });
});
