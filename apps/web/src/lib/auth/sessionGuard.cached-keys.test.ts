import { describe, it, expect, vi, afterEach } from 'vitest';
import { CACHED_AUTH_KEYS, clearCachedAuthorizations } from './sessionGuard';

/** The exact seven keys the logout wipe must remove — hardcoded so a key
 *  added to the module but forgotten in CACHED_AUTH_KEYS still fails here. */
const EXPECTED_KEYS = [
  'accensa:active_session_account',
  'accensa:session_timestamp',
  'accensa_session',
  'accensa_auth_token',
  'accensa_active_account',
  'accensa:session_role',
  'accensa:auth_challenge',
] as const;

class FakeStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CACHED_AUTH_KEYS', () => {
  it('has exactly seven distinct entries', () => {
    expect(CACHED_AUTH_KEYS).toHaveLength(7);
    expect(new Set(CACHED_AUTH_KEYS).size).toBe(7);
  });

  it('every entry is prefixed accensa', () => {
    for (const key of CACHED_AUTH_KEYS) {
      expect(key).toMatch(/^accensa/);
    }
  });

  it('contains exactly the expected key set', () => {
    expect([...CACHED_AUTH_KEYS].sort()).toEqual([...EXPECTED_KEYS].sort());
  });
});

describe('clearCachedAuthorizations', () => {
  it('removes every cached key from both localStorage and sessionStorage', () => {
    const local = new FakeStorage();
    const session = new FakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });

    for (const key of CACHED_AUTH_KEYS) {
      local.setItem(key, 'value');
      session.setItem(key, 'value');
    }

    clearCachedAuthorizations();

    for (const key of CACHED_AUTH_KEYS) {
      expect(local.getItem(key)).toBeNull();
      expect(session.getItem(key)).toBeNull();
    }
  });

  it('leaves unrelated keys intact in both storages', () => {
    const local = new FakeStorage();
    const session = new FakeStorage();
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });

    for (const key of CACHED_AUTH_KEYS) {
      local.setItem(key, 'value');
      session.setItem(key, 'value');
    }
    local.setItem('app:unrelated', 'keep');
    session.setItem('app:unrelated', 'keep');

    clearCachedAuthorizations();

    expect(local.getItem('app:unrelated')).toBe('keep');
    expect(session.getItem('app:unrelated')).toBe('keep');
  });

  it('does not throw when removeItem throws', () => {
    const throwing = {
      removeItem: () => {
        throw new Error('storage quota exceeded');
      },
    } as unknown as Storage;
    vi.stubGlobal('window', { localStorage: throwing, sessionStorage: throwing });

    expect(() => clearCachedAuthorizations()).not.toThrow();
  });
});
