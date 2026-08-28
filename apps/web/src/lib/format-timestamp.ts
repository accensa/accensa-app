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
export function formatTimestamp(input: Date | string | number, timezone = 'UTC'): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
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
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')} ${timezone}`;
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
export function getTimezoneAbbr(timezone = 'UTC'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}
