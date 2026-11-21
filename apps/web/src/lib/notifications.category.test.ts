import { describe, it, expect } from 'vitest';
import { parseNotificationCategory, NOTIFICATION_CATEGORIES } from './notifications';

describe('parseNotificationCategory — accepted set', () => {
  it('has exactly four known categories', () => {
    expect(NOTIFICATION_CATEGORIES).toHaveLength(4);
  });

  it('returns every member of NOTIFICATION_CATEGORIES as-is', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(parseNotificationCategory(category)).toBe(category);
    }
  });
});

describe('parseNotificationCategory — rejection', () => {
  it('is case-sensitive: leading-uppercase spellings return null', () => {
    expect(parseNotificationCategory('Security')).toBeNull();
    expect(parseNotificationCategory('Transactions')).toBeNull();
    expect(parseNotificationCategory('Disputes')).toBeNull();
    expect(parseNotificationCategory('System')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseNotificationCategory('')).toBeNull();
  });

  it('rejects whitespace-padded strings', () => {
    expect(parseNotificationCategory(' security')).toBeNull();
    expect(parseNotificationCategory('security ')).toBeNull();
  });

  it('rejects non-string inputs: array, boolean, null, undefined', () => {
    // toBeNull(), not toBeFalsy(), so an empty-string return also fails.
    expect(parseNotificationCategory([])).toBeNull();
    expect(parseNotificationCategory(true)).toBeNull();
    expect(parseNotificationCategory(null)).toBeNull();
    expect(parseNotificationCategory(undefined)).toBeNull();
  });

  it('never returns the system default — the ?? fallback lives in fromRow, not here', () => {
    // If the default were moved into the parser, any of these would return 'system'
    // and the toBeNull() assertion would catch it.
    const rejected: unknown[] = ['Security', '', ' security', [], true];
    for (const input of rejected) {
      expect(parseNotificationCategory(input)).toBeNull();
    }
  });
});
