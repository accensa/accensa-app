import { describe, it, expect } from 'vitest';
import { formatTimestamp } from './format-timestamp';

/**
 * The suffix is the zone abbreviation for the instant being formatted, not the raw
 * IANA id. New York is EST in January and EDT in July, so a label taken from "now"
 * rather than from the instant would be wrong for half of the year.
 */
describe('formatTimestamp zone label', () => {
  const winter = new Date('2026-01-15T23:20:00.000Z');
  const summer = new Date('2026-07-15T23:20:00.000Z');

  it('labels UTC as UTC', () => {
    expect(formatTimestamp(winter)).toMatch(/11:20:00 pm UTC$/);
  });

  it('uses the standard-time abbreviation in winter', () => {
    const result = formatTimestamp(winter, 'America/New_York');
    expect(result).toMatch(/6:20:00 pm EST$/);
    expect(result).not.toContain('America/New_York');
  });

  it('uses the daylight-time abbreviation in summer', () => {
    const result = formatTimestamp(summer, 'America/New_York');
    expect(result).toMatch(/7:20:00 pm EDT$/);
  });

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    const result = formatTimestamp(winter, 'Europe/Nowhere');
    expect(result).toBe(formatTimestamp(winter, 'UTC'));
    expect(result).toMatch(/UTC$/);
  });
});
