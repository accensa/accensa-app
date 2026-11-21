/**
 * Deterministic timestamp formatting.
 *
 * `toLocaleString()` with no arguments uses the runtime's locale and timezone,
 * which differ between server and client in Next.js. That causes hydration
 * mismatches and ambiguous output. This module fixes both problems.
 *
 * Approach: format with an explicit locale and timezone (UTC by default) so
 * server and client always agree. The precise instant is carried as an ISO 8601
 * `dateTime` attribute on a `<time>` element, and the timezone is shown in the
 * display string or discoverable on hover/focus via the `title` attribute.
 *
 * A fixed timezone (rather than deferred-to-mount) was chosen because:
 *  - It is simpler: no useEffect, no hydration mismatch, no flicker.
 *  - UTC is unambiguous for financial reconciliation, which is the primary
 *    use case. A merchant needs to know whose clock a settlement time is on;
 *    "11:20:00 UTC" answers that. "11:20:00" does not.
 *  - The out-of-scope note in the issue says timezone preference is a later
 *    change; being unambiguous is this issue.
 */

/**
 * Formats a Date (or ISO string / epoch-ms number) as a human-readable
 * string with an explicit timezone indicator.
 *
 * @param input       A Date, ISO 8601 string, or epoch milliseconds.
 * @param timezone    IANA timezone name. Defaults to `'UTC'`.
 * @returns           e.g. `"3 Apr 2026, 11:20:00 PM UTC"`
 */
/**
 * Resolves an IANA zone once, falling back to `'UTC'` when `Intl` rejects it.
 *
 * `Intl.DateTimeFormat` throws `RangeError` for an unknown or empty zone, and this
 * module's callers include server rendering, so the fallback belongs here rather than
 * in every caller. The resolved value is used for both the formatter and the suffix,
 * so the digits and the label can never disagree.
 */
function resolveTimezone(timezone: string): string {
  const candidate = timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

export function formatTimestamp(input: Date | string | number, timezone = 'UTC'): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  const zone = resolveTimezone(timezone);

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  // en-GB gives "3" for day (no leading zero), "Apr" for month, etc.
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')} ${getTimezoneAbbr(zone, date)}`;
}

/**
 * Returns the ISO 8601 dateTime string for a timestamp.
 *
 * Used as the `dateTime` attribute on `<time>` elements so the precise
 * instant is available to tooling and assistive technology.
 */
export function toISO8601(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/**
 * Returns the timezone abbreviation for display (e.g. "UTC", "EST").
 *
 * This is a best-effort extraction from the Intl API; some timezones
 * return UTC offsets rather than abbreviations.
 */
export function getTimezoneAbbr(timezone = 'UTC', at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}
