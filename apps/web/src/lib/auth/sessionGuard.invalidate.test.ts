/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CACHED_AUTH_KEYS, invalidateSession } from './sessionGuard';

describe('invalidateSession — CACHED_AUTH_KEYS coverage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('CACHED_AUTH_KEYS has exactly 7 entries', () => {
    expect(CACHED_AUTH_KEYS.length).toBe(7);
  });

  it('clears all 7 CACHED_AUTH_KEYS from both localStorage and sessionStorage', async () => {
    for (const key of CACHED_AUTH_KEYS) {
      window.localStorage.setItem(key, 'test-value');
      window.sessionStorage.setItem(key, 'test-value');
    }
    // An unrelated key must survive
    window.localStorage.setItem('unrelated-key', 'keep-me');
    window.sessionStorage.setItem('unrelated-key', 'keep-me');

    await invalidateSession({ callLogoutApi: false, dispatchCustomEvent: false });

    for (const key of CACHED_AUTH_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    }

    expect(window.localStorage.getItem('unrelated-key')).toBe('keep-me');
    expect(window.sessionStorage.getItem('unrelated-key')).toBe('keep-me');
  });

  it('covers the default-storage path (no storage option)', async () => {
    for (const key of CACHED_AUTH_KEYS) {
      window.localStorage.setItem(key, 'test-value');
      window.sessionStorage.setItem(key, 'test-value');
    }

    await invalidateSession({ callLogoutApi: false, dispatchCustomEvent: false });

    for (const key of CACHED_AUTH_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
    }
  });
});
