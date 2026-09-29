import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SessionAccountMismatchError,
  compareSessionAccount,
  isSessionMatching,
  assertValidSession,
  guardTransactionExecution,
  getActiveSessionAccount,
  setActiveSessionAccount,
  clearActiveSessionAccount,
  clearCachedAuthorizations,
  invalidateSession,
  handleAccountSwitch,
  SESSION_ACCOUNT_STORAGE_KEY,
  SESSION_TIMESTAMP_KEY,
  CACHED_AUTH_KEYS,
} from './sessionGuard';

const ACCOUNT_A = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const ACCOUNT_B = 'GBKNGF67M4FBWNCNIFR4LTFXHZD5RDUSMQ5YJL4R7R7N7OXOWLIEMVYV';

class MockStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('sessionGuard', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
    vi.restoreAllMocks();
  });

  describe('compareSessionAccount', () => {
    it('returns true when addresses match exactly', () => {
      expect(compareSessionAccount(ACCOUNT_A, ACCOUNT_A)).toBe(true);
    });

    it('returns true when addresses match case-insensitively', () => {
      expect(compareSessionAccount(ACCOUNT_A.toLowerCase(), ACCOUNT_A.toUpperCase())).toBe(true);
    });

    it('trims whitespace before comparing', () => {
      expect(compareSessionAccount(`  ${ACCOUNT_A}  `, ACCOUNT_A)).toBe(true);
    });

    it('returns false when addresses differ', () => {
      expect(compareSessionAccount(ACCOUNT_A, ACCOUNT_B)).toBe(false);
    });

    it('returns false when either or both addresses are missing', () => {
      expect(compareSessionAccount(ACCOUNT_A, null)).toBe(false);
      expect(compareSessionAccount(null, ACCOUNT_A)).toBe(false);
      expect(compareSessionAccount(undefined, ACCOUNT_B)).toBe(false);
      expect(compareSessionAccount('', '')).toBe(false);
      expect(compareSessionAccount(null, null)).toBe(false);
    });
  });

  describe('isSessionMatching', () => {
    it('returns true when there is no active session account', () => {
      expect(isSessionMatching(null, ACCOUNT_A)).toBe(true);
      expect(isSessionMatching(undefined, ACCOUNT_A)).toBe(true);
    });

    it('returns true when session account matches wallet account', () => {
      expect(isSessionMatching(ACCOUNT_A, ACCOUNT_A)).toBe(true);
    });

    it('returns false when session account differs from wallet account', () => {
      expect(isSessionMatching(ACCOUNT_A, ACCOUNT_B)).toBe(false);
      expect(isSessionMatching(ACCOUNT_A, null)).toBe(false);
    });
  });

  describe('assertValidSession', () => {
    it('does not throw when session account matches wallet account', () => {
      expect(() => assertValidSession(ACCOUNT_A, ACCOUNT_A)).not.toThrow();
    });

    it('does not throw when there is no session account', () => {
      expect(() => assertValidSession(null, ACCOUNT_A)).not.toThrow();
      expect(() => assertValidSession(undefined, ACCOUNT_A)).not.toThrow();
    });

    it('throws SessionAccountMismatchError when accounts mismatch', () => {
      expect(() => assertValidSession(ACCOUNT_A, ACCOUNT_B)).toThrow(SessionAccountMismatchError);
      try {
        assertValidSession(ACCOUNT_A, ACCOUNT_B);
      } catch (err) {
        expect(err).toBeInstanceOf(SessionAccountMismatchError);
        const mismatchErr = err as SessionAccountMismatchError;
        expect(mismatchErr.sessionAccount).toBe(ACCOUNT_A);
        expect(mismatchErr.currentWalletAccount).toBe(ACCOUNT_B);
        expect(mismatchErr.message).toContain(ACCOUNT_A);
        expect(mismatchErr.message).toContain(ACCOUNT_B);
      }
    });
  });

  describe('guardTransactionExecution', () => {
    it('allows transaction when session account matches current wallet account', () => {
      expect(() => guardTransactionExecution(ACCOUNT_A, ACCOUNT_A)).not.toThrow();
    });

    it('allows transaction when no session was set but wallet is connected', () => {
      expect(() => guardTransactionExecution(null, ACCOUNT_A)).not.toThrow();
    });

    it('throws when no wallet account is active', () => {
      expect(() => guardTransactionExecution(ACCOUNT_A, null)).toThrow(SessionAccountMismatchError);
      expect(() => guardTransactionExecution(null, null)).toThrow(SessionAccountMismatchError);
    });

    it('throws when current wallet account differs from authenticated session', () => {
      expect(() => guardTransactionExecution(ACCOUNT_A, ACCOUNT_B)).toThrow(
        SessionAccountMismatchError,
      );
      expect(() => guardTransactionExecution(ACCOUNT_A, ACCOUNT_B)).toThrow(
        /Transaction signing blocked/,
      );
    });
  });

  describe('Storage helpers', () => {
    it('saves and reads active session account', () => {
      setActiveSessionAccount(ACCOUNT_A, mockStorage);
      expect(getActiveSessionAccount(mockStorage)).toBe(ACCOUNT_A);
      expect(mockStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY)).toBe(ACCOUNT_A);
      expect(mockStorage.getItem(SESSION_TIMESTAMP_KEY)).toBeTruthy();
    });

    it('clears active session account', () => {
      setActiveSessionAccount(ACCOUNT_A, mockStorage);
      clearActiveSessionAccount(mockStorage);
      expect(getActiveSessionAccount(mockStorage)).toBeNull();
      expect(mockStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY)).toBeNull();
    });

    it('clears all cached authorization keys', () => {
      for (const key of CACHED_AUTH_KEYS) {
        mockStorage.setItem(key, 'some-value');
      }
      mockStorage.setItem('other_app_setting', 'keep-me');

      clearCachedAuthorizations(mockStorage);

      for (const key of CACHED_AUTH_KEYS) {
        expect(mockStorage.getItem(key)).toBeNull();
      }
      expect(mockStorage.getItem('other_app_setting')).toBe('keep-me');
    });
  });

  describe('invalidateSession', () => {
    it('clears cached authorizations in storage', async () => {
      setActiveSessionAccount(ACCOUNT_A, mockStorage);
      mockStorage.setItem('accensa_auth_token', 'jwt-token-xyz');

      await invalidateSession({
        storage: mockStorage,
        callLogoutApi: false,
        dispatchCustomEvent: false,
      });

      expect(mockStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY)).toBeNull();
      expect(mockStorage.getItem('accensa_auth_token')).toBeNull();
    });

    it('calls /api/auth/logout when callLogoutApi is true', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      await invalidateSession({
        storage: mockStorage,
        callLogoutApi: true,
        dispatchCustomEvent: false,
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('dispatches accensa:session-invalidated CustomEvent on window', async () => {
      const dispatchMock = vi.fn();
      vi.stubGlobal('window', { dispatchEvent: dispatchMock });

      await invalidateSession({
        storage: mockStorage,
        callLogoutApi: false,
        dispatchCustomEvent: true,
        previousAccount: ACCOUNT_A,
        newAccount: ACCOUNT_B,
        reason: 'wallet_account_switched',
      });

      expect(dispatchMock).toHaveBeenCalled();
      const dispatchedEvent = dispatchMock.mock.calls[0][0];
      expect(dispatchedEvent.type).toBe('accensa:session-invalidated');
      expect(dispatchedEvent.detail).toMatchObject({
        reason: 'wallet_account_switched',
        previousAccount: ACCOUNT_A,
        newAccount: ACCOUNT_B,
      });
    });

    it('does not crash if fetch rejects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      await expect(
        invalidateSession({
          storage: mockStorage,
          callLogoutApi: true,
          dispatchCustomEvent: false,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('handleAccountSwitch', () => {
    it('returns hasMismatch: false when no session was active', async () => {
      const result = await handleAccountSwitch(ACCOUNT_B, null, {
        storage: mockStorage,
        callLogoutApi: false,
        dispatchCustomEvent: false,
      });

      expect(result).toEqual({
        hasMismatch: false,
        invalidated: false,
        previousAccount: null,
        newAccount: ACCOUNT_B,
      });
    });

    it('returns hasMismatch: false when wallet account matches session', async () => {
      setActiveSessionAccount(ACCOUNT_A, mockStorage);

      const result = await handleAccountSwitch(ACCOUNT_A, ACCOUNT_A, {
        storage: mockStorage,
        callLogoutApi: false,
        dispatchCustomEvent: false,
      });

      expect(result).toEqual({
        hasMismatch: false,
        invalidated: false,
        previousAccount: ACCOUNT_A,
        newAccount: ACCOUNT_A,
      });
      // Storage should still hold the session
      expect(mockStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY)).toBe(ACCOUNT_A);
    });

    it('detects mismatch, invalidates session, and clears storage when accounts differ', async () => {
      setActiveSessionAccount(ACCOUNT_A, mockStorage);

      const result = await handleAccountSwitch(ACCOUNT_B, ACCOUNT_A, {
        storage: mockStorage,
        callLogoutApi: false,
        dispatchCustomEvent: false,
      });

      expect(result).toEqual({
        hasMismatch: true,
        invalidated: true,
        previousAccount: ACCOUNT_A,
        newAccount: ACCOUNT_B,
      });
      // Storage must now be purged
      expect(mockStorage.getItem(SESSION_ACCOUNT_STORAGE_KEY)).toBeNull();
    });
  });
});
