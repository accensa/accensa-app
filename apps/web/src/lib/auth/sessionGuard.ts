/**
 * Session Guard & Invalidation on Wallet Account Switch
 *
 * Enforces security by verifying that the authenticated session account matches
 * the currently active wallet address. If a user switches accounts in their
 * wallet extension (Freighter, xBull, Hana, etc.), cached authorizations are
 * purged, server-side cookies are invalidated, and transaction execution is blocked
 * until re-authentication.
 *
 * @module
 */

export class SessionAccountMismatchError extends Error {
  public readonly sessionAccount: string | null;
  public readonly currentWalletAccount: string | null;

  constructor(
    sessionAccount?: string | null,
    currentWalletAccount?: string | null,
    customMessage?: string,
  ) {
    const msg =
      customMessage ||
      (sessionAccount && currentWalletAccount
        ? `Wallet account mismatch: Active session belongs to ${sessionAccount}, but active wallet is ${currentWalletAccount}. Session has been invalidated.`
        : 'Wallet account does not match active authenticated session.');
    super(msg);
    this.name = 'SessionAccountMismatchError';
    this.sessionAccount = sessionAccount ?? null;
    this.currentWalletAccount = currentWalletAccount ?? null;
    Object.setPrototypeOf(this, SessionAccountMismatchError.prototype);
  }
}

/** Storage key for tracking the account associated with the active session. */
export const SESSION_ACCOUNT_STORAGE_KEY = 'accensa:active_session_account';
export const SESSION_TIMESTAMP_KEY = 'accensa:session_timestamp';

/** Local and session storage keys cleared when a session is invalidated. */
export const CACHED_AUTH_KEYS = [
  SESSION_ACCOUNT_STORAGE_KEY,
  SESSION_TIMESTAMP_KEY,
  'accensa_session',
  'accensa_auth_token',
  'accensa_active_account',
  'accensa:session_role',
  'accensa:auth_challenge',
] as const;

/**
 * Compares two Stellar public keys.
 * Returns true if both are valid non-empty strings and match (case-insensitive).
 */
export function compareSessionAccount(
  sessionAccount?: string | null,
  walletAccount?: string | null,
): boolean {
  if (!sessionAccount || !walletAccount) return false;
  return sessionAccount.trim().toUpperCase() === walletAccount.trim().toUpperCase();
}

/**
 * Checks whether an account is valid for the current session.
 * If no session is active (sessionAccount is null/undefined), returns true.
 * If a session is active, requires an exact match with the wallet account.
 */
export function isSessionMatching(
  sessionAccount?: string | null,
  walletAccount?: string | null,
): boolean {
  if (!sessionAccount) return true;
  return compareSessionAccount(sessionAccount, walletAccount);
}

/**
 * Asserts that the current wallet account matches the active session.
 * Throws SessionAccountMismatchError if sessionAccount is present and differs.
 */
export function assertValidSession(
  sessionAccount?: string | null,
  currentWalletAccount?: string | null,
): void {
  if (sessionAccount && !compareSessionAccount(sessionAccount, currentWalletAccount)) {
    throw new SessionAccountMismatchError(sessionAccount, currentWalletAccount);
  }
}

/**
 * Specifically guards transaction signing and payment execution against
 * accidental execution under an unintended wallet address.
 */
export function guardTransactionExecution(
  sessionAccount?: string | null,
  currentWalletAccount?: string | null,
): void {
  if (!currentWalletAccount) {
    throw new SessionAccountMismatchError(
      sessionAccount,
      currentWalletAccount,
      'No active wallet account detected to execute transaction.',
    );
  }
  if (sessionAccount && !compareSessionAccount(sessionAccount, currentWalletAccount)) {
    throw new SessionAccountMismatchError(
      sessionAccount,
      currentWalletAccount,
      `Transaction signing blocked: Session is authenticated for ${sessionAccount}, but wallet is currently switched to ${currentWalletAccount}. Please switch back or re-authenticate.`,
    );
  }
}

/** Reads the active session account from storage. */
export function getActiveSessionAccount(storage?: Storage): string | null {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    return s ? s.getItem(SESSION_ACCOUNT_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

/** Persists the active session account in storage. */
export function setActiveSessionAccount(account: string, storage?: Storage): void {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (s) {
      s.setItem(SESSION_ACCOUNT_STORAGE_KEY, account.trim());
      s.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
    }
  } catch {
    // Ignore storage quota or access errors in restricted modes
  }
}

/** Clears the active session account from storage. */
export function clearActiveSessionAccount(storage?: Storage): void {
  try {
    const s = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (s) {
      s.removeItem(SESSION_ACCOUNT_STORAGE_KEY);
      s.removeItem(SESSION_TIMESTAMP_KEY);
    }
  } catch {
    // Ignore
  }
}

/** Clears all cached authorization data from localStorage and sessionStorage. */
export function clearCachedAuthorizations(storage?: Storage): void {
  try {
    const local = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (local) {
      for (const key of CACHED_AUTH_KEYS) {
        local.removeItem(key);
      }
    }
    const session = typeof window !== 'undefined' ? window.sessionStorage : undefined;
    if (session) {
      for (const key of CACHED_AUTH_KEYS) {
        session.removeItem(key);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

export interface InvalidateSessionOptions {
  /** Whether to trigger POST /api/auth/logout to delete the HTTP-only cookie. Default: true */
  callLogoutApi?: boolean;
  /** Reason for invalidation. Default: 'wallet_account_switched' */
  reason?: string;
  /** Custom storage instance for testing or dependency injection. */
  storage?: Storage;
  /** Whether to dispatch the accensa:session-invalidated window event. Default: true */
  dispatchCustomEvent?: boolean;
  /** The session account that was previously active. */
  previousAccount?: string | null;
  /** The newly switched wallet account. */
  newAccount?: string | null;
}

/**
 * Instantly invalidates an active session:
 * 1. Purges local cached authorizations and session account markers.
 * 2. Fires POST /api/auth/logout to delete the server-side HTTP-only session cookie.
 * 3. Dispatches a window CustomEvent ('accensa:session-invalidated') for reactive UI handling.
 */
export async function invalidateSession(options: InvalidateSessionOptions = {}): Promise<void> {
  const {
    callLogoutApi = true,
    reason = 'wallet_account_switched',
    storage,
    dispatchCustomEvent = true,
    previousAccount = null,
    newAccount = null,
  } = options;

  clearCachedAuthorizations(storage);

  if (callLogoutApi && typeof fetch === 'function') {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    } catch {
      // Invalidation succeeds locally even if the server is unreachable
    }
  }

  if (
    dispatchCustomEvent &&
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
  ) {
    try {
      const event = new CustomEvent('accensa:session-invalidated', {
        detail: {
          reason,
          previousAccount,
          newAccount,
          timestamp: Date.now(),
        },
      });
      window.dispatchEvent(event);
    } catch {
      // Ignore event dispatch failure in non-browser runtimes
    }
  }
}

export interface AccountSwitchResult {
  hasMismatch: boolean;
  invalidated: boolean;
  previousAccount: string | null;
  newAccount: string | null;
}

/**
 * Checks if the newly active wallet account differs from the established session.
 * If a mismatch is detected, instantly triggers session invalidation.
 */
export async function handleAccountSwitch(
  newWalletAccount: string | null,
  activeSessionAccount?: string | null,
  options?: InvalidateSessionOptions,
): Promise<AccountSwitchResult> {
  const sessionAcc = activeSessionAccount ?? getActiveSessionAccount(options?.storage);

  // If there was no authenticated session, or the account is the same, no mismatch
  if (!sessionAcc || compareSessionAccount(sessionAcc, newWalletAccount)) {
    return {
      hasMismatch: false,
      invalidated: false,
      previousAccount: sessionAcc,
      newAccount: newWalletAccount,
    };
  }

  // Account mismatch detected! Instantly invalidate session.
  await invalidateSession({
    ...options,
    reason: 'wallet_account_switched',
    previousAccount: sessionAcc,
    newAccount: newWalletAccount,
  });

  return {
    hasMismatch: true,
    invalidated: true,
    previousAccount: sessionAcc,
    newAccount: newWalletAccount,
  };
}
