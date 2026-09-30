'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { ShieldAlert, X, LogIn } from 'lucide-react';
import {
  truncateAddress,
  getDefaultAdapter,
  type WalletAdapter,
  type WalletStatus,
} from '@/lib/wallet';
import {
  compareSessionAccount,
  guardTransactionExecution,
  invalidateSession,
  getActiveSessionAccount,
  setActiveSessionAccount,
  SessionAccountMismatchError,
} from '@/lib/auth/sessionGuard';

export interface MismatchDetails {
  previousAccount: string;
  newAccount: string;
}

export interface WalletContextValue {
  /** The current active wallet address from the provider or extension. */
  account: string | null;
  /** The authenticated session address, if a session was established. */
  sessionAccount: string | null;
  /** Whether the wallet is currently connected. */
  isConnected: boolean;
  /** Current connection status. */
  status: WalletStatus['kind'];
  /** Error message from wallet provider, if any. */
  error: string | null;
  /** Warning message displayed if wallet switch invalidated an active session. */
  sessionMismatchWarning: string | null;
  /** Address details when an account mismatch occurs. */
  mismatchDetails: MismatchDetails | null;
  /** Whether the warning toast is currently visible. */
  showWarningToast: boolean;
  /** Connects to the wallet extension. */
  connectWallet: () => Promise<void>;
  /** Disconnects the current wallet. */
  disconnectWallet: () => Promise<void>;
  /** Clears the mismatch warning and hides the warning toast. */
  clearMismatchWarning: () => void;
  /**
   * Safely signs a transaction envelope.
   * Asserts that the active wallet address matches the authenticated session account
   * before forwarding to the wallet adapter, preventing unauthorized actions.
   */
  signTransaction: (
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ) => Promise<string>;
  /** Associates an authenticated session with an account. */
  setAuthenticatedSession: (address: string) => void;
  /** Manually or programmatically triggers an account change notification. */
  notifyAccountChange: (newAddress: string | null) => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export interface WalletProviderProps {
  children: React.ReactNode;
  adapter?: WalletAdapter;
  initialAccount?: string | null;
  initialSessionAccount?: string | null;
  renderToast?: boolean;
  onAccountMismatch?: (details: MismatchDetails) => void;
  onReauthenticate?: () => void;
}

/** Formats a security warning message when a session mismatch is triggered. */
export function formatMismatchWarning(
  previousSessionAccount: string,
  newWalletAccount: string | null,
): string {
  return newWalletAccount
    ? `Your wallet account switched to ${truncateAddress(newWalletAccount)}. Your active session for ${truncateAddress(previousSessionAccount)} was terminated for security. Please switch back or re-authenticate.`
    : `Your wallet disconnected while an active session for ${truncateAddress(previousSessionAccount)} was open. Session was terminated for security.`;
}

/**
 * Creates a guarded transaction signer that asserts wallet account and session match
 * before delegating to the wallet adapter.
 */
export function createSafeSignTransaction(
  adapter: WalletAdapter,
  sessionAccount: string | null,
  activeAccount: string | null,
) {
  return async (
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<string> => {
    // Assert active account matches session
    guardTransactionExecution(sessionAccount, activeAccount);

    // Verify target address options (if specified) also match active account
    if (opts.address && activeAccount && !compareSessionAccount(opts.address, activeAccount)) {
      throw new SessionAccountMismatchError(
        opts.address,
        activeAccount,
        `Transaction signing rejected: Target address ${opts.address} does not match active wallet ${activeAccount}.`,
      );
    }

    return await adapter.signTransaction(xdr, opts);
  };
}

/**
 * Subscribes to account change events across Freighter, xBull, Hana, and window CustomEvents.
 * Returns an unregister cleanup function.
 */
export function registerWalletEventListeners(
  onAccountChanged: (newAddress: string | null) => void,
  onWindowFocusOrVisible?: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const extractAddress = (payload: unknown): string | null => {
    if (!payload) return null;
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object') {
      const obj = payload as { address?: unknown; publicKey?: unknown; account?: unknown };
      if (typeof obj.address === 'string') return obj.address;
      if (typeof obj.publicKey === 'string') return obj.publicKey;
      if (typeof obj.account === 'string') return obj.account;
    }
    return null;
  };

  type WalletEventEmitter = {
    on?: (event: string, cb: (data: unknown) => void) => void;
    removeListener?: (event: string, cb: (data: unknown) => void) => void;
    off?: (event: string, cb: (data: unknown) => void) => void;
    addListener?: (event: string, cb: (data: unknown) => void) => void;
  };

  const win = window as unknown as {
    freighter?: WalletEventEmitter;
    freighterApi?: WalletEventEmitter;
    xBullSDK?: WalletEventEmitter;
    xBull?: WalletEventEmitter;
    hanaWallet?: WalletEventEmitter;
    hana?: WalletEventEmitter;
  };

  const onProviderAccountChanged = (data: unknown) => {
    const newAddr = extractAddress(data);
    onAccountChanged(newAddr);
  };

  const freighter = win.freighter || win.freighterApi;
  freighter?.on?.('accountChanged', onProviderAccountChanged);
  freighter?.addListener?.('accountChanged', onProviderAccountChanged);

  const xBull = win.xBullSDK || win.xBull;
  xBull?.on?.('accountChanged', onProviderAccountChanged);
  xBull?.addListener?.('accountChanged', onProviderAccountChanged);

  const hana = win.hanaWallet || win.hana;
  hana?.on?.('accountChanged', onProviderAccountChanged);
  hana?.addListener?.('accountChanged', onProviderAccountChanged);

  const onWindowEvent = (e: Event) => {
    const customEvent = e as CustomEvent;
    const newAddr = extractAddress(customEvent.detail ?? customEvent);
    onAccountChanged(newAddr);
  };

  window.addEventListener('accountChanged', onWindowEvent);
  window.addEventListener('freighter:accountChanged', onWindowEvent);
  window.addEventListener('stellar:accountChanged', onWindowEvent);
  window.addEventListener('accensa:account-changed', onWindowEvent);

  const handleFocus = () => {
    onWindowFocusOrVisible?.();
  };
  window.addEventListener('focus', handleFocus);

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      onWindowFocusOrVisible?.();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return () => {
    freighter?.off?.('accountChanged', onProviderAccountChanged);
    freighter?.removeListener?.('accountChanged', onProviderAccountChanged);
    xBull?.off?.('accountChanged', onProviderAccountChanged);
    xBull?.removeListener?.('accountChanged', onProviderAccountChanged);
    hana?.off?.('accountChanged', onProviderAccountChanged);
    hana?.removeListener?.('accountChanged', onProviderAccountChanged);

    window.removeEventListener('accountChanged', onWindowEvent);
    window.removeEventListener('freighter:accountChanged', onWindowEvent);
    window.removeEventListener('stellar:accountChanged', onWindowEvent);
    window.removeEventListener('accensa:account-changed', onWindowEvent);
    window.removeEventListener('focus', handleFocus);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}

/**
 * Toast component rendering the non-modal warning when a wallet account switch occurs.
 */
export function SessionMismatchToast({
  warning,
  details,
  onDismiss,
  onReauthenticate,
}: {
  warning: string;
  details?: MismatchDetails | null;
  onDismiss: () => void;
  onReauthenticate?: () => void;
}) {
  const handleReauth = () => {
    if (onReauthenticate) {
      onReauthenticate();
    } else if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="session-mismatch-toast"
      className="fixed bottom-6 right-6 z-[80] max-w-md w-full bg-amber-50/95 dark:bg-[#0d1620]/95 backdrop-blur-2xl border border-amber-300 dark:border-amber-500/30 text-slate-800 dark:text-slate-100 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start gap-3.5">
        <div className="p-2 bg-amber-100 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-amber-800 dark:text-amber-400">
              Session Terminated: Wallet Switched
            </h3>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss warning"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{warning}</p>
          {details && (
            <div className="pt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-col gap-0.5">
              <span>{`Previous session: ${truncateAddress(details.previousAccount)}`}</span>
              <span>{`Active wallet: ${truncateAddress(details.newAccount)}`}</span>
            </div>
          )}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={handleReauth}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 dark:bg-amber-500 text-white dark:text-black text-xs font-bold uppercase tracking-wider hover:bg-amber-500 dark:hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Re-authenticate</span>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WalletProvider({
  children,
  adapter = getDefaultAdapter(),
  initialAccount = null,
  initialSessionAccount = null,
  renderToast = true,
  onAccountMismatch,
  onReauthenticate,
}: WalletProviderProps) {
  const [account, setAccount] = useState<string | null>(initialAccount);
  const [sessionAccount, setSessionAccount] = useState<string | null>(
    () =>
      initialSessionAccount ?? (typeof window !== 'undefined' ? getActiveSessionAccount() : null),
  );
  const [status, setStatus] = useState<WalletStatus['kind']>(
    initialAccount ? 'connected' : 'disconnected',
  );
  const [error, setError] = useState<string | null>(null);
  const [sessionMismatchWarning, setSessionMismatchWarning] = useState<string | null>(null);
  const [mismatchDetails, setMismatchDetails] = useState<MismatchDetails | null>(null);
  const [showWarningToast, setShowWarningToast] = useState<boolean>(false);

  // Keep ref to latest sessionAccount to avoid stale closures in listeners
  const sessionAccountRef = useRef<string | null>(sessionAccount);
  const accountRef = useRef<string | null>(account);

  useEffect(() => {
    sessionAccountRef.current = sessionAccount;
  }, [sessionAccount]);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  // Handle account change events
  const handleAccountChange = useCallback(
    async (newAddress: string | null) => {
      const currentActiveSession = sessionAccountRef.current;
      const normalizedNew = newAddress ? newAddress.trim() : null;

      // If there is an active session and the new address differs from it:
      if (currentActiveSession && !compareSessionAccount(currentActiveSession, normalizedNew)) {
        await invalidateSession({
          reason: 'wallet_account_switched',
          previousAccount: currentActiveSession,
          newAccount: normalizedNew,
        });

        const details: MismatchDetails = {
          previousAccount: currentActiveSession,
          newAccount: normalizedNew || 'unknown',
        };

        const warningMsg = formatMismatchWarning(currentActiveSession, normalizedNew);

        setSessionAccount(null);
        setSessionMismatchWarning(warningMsg);
        setMismatchDetails(details);
        setShowWarningToast(true);

        onAccountMismatch?.(details);
      }

      setAccount(normalizedNew);
      if (normalizedNew) {
        setStatus('connected');
        setError(null);
      } else {
        setStatus('disconnected');
      }
    },
    [onAccountMismatch],
  );

  // Connect wallet
  const connectWallet = useCallback(async () => {
    try {
      setError(null);
      const res = await adapter.connect();
      setStatus(res.kind);
      if (res.kind === 'connected') {
        await handleAccountChange(res.address);
      } else if (res.kind === 'error') {
        setError(res.message);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(msg);
      setStatus('error');
    }
  }, [adapter, handleAccountChange]);

  // Disconnect wallet
  const disconnectWallet = useCallback(async () => {
    await handleAccountChange(null);
    setStatus('disconnected');
  }, [handleAccountChange]);

  // Clear warning toast
  const clearMismatchWarning = useCallback(() => {
    setShowWarningToast(false);
    setSessionMismatchWarning(null);
    setMismatchDetails(null);
  }, []);

  // Set authenticated session (called on login)
  const setAuthenticatedSession = useCallback((address: string) => {
    const trimmed = address.trim();
    setSessionAccount(trimmed);
    setActiveSessionAccount(trimmed);
    setSessionMismatchWarning(null);
    setMismatchDetails(null);
    setShowWarningToast(false);
  }, []);

  // Safe transaction signing with account discrepancy guard
  const signTransaction = useCallback(
    async (xdr: string, opts: { networkPassphrase: string; address?: string }): Promise<string> => {
      const safeSign = createSafeSignTransaction(
        adapter,
        sessionAccountRef.current,
        accountRef.current,
      );
      return await safeSign(xdr, opts);
    },
    [adapter],
  );

  // Setup account change listeners across wallet providers
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const current = await adapter.readStatus();
        if (current.kind === 'connected' && current.address) {
          if (accountRef.current && current.address !== accountRef.current) {
            void handleAccountChange(current.address);
          }
        }
      } catch {
        // Ignore read failures on blur/focus
      }
    };

    return registerWalletEventListeners((newAddr) => {
      void handleAccountChange(newAddr);
    }, checkStatus);
  }, [adapter, handleAccountChange]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      sessionAccount,
      isConnected: Boolean(account) && status === 'connected',
      status,
      error,
      sessionMismatchWarning,
      mismatchDetails,
      showWarningToast,
      connectWallet,
      disconnectWallet,
      clearMismatchWarning,
      signTransaction,
      setAuthenticatedSession,
      notifyAccountChange: handleAccountChange,
    }),
    [
      account,
      sessionAccount,
      status,
      error,
      sessionMismatchWarning,
      mismatchDetails,
      showWarningToast,
      connectWallet,
      disconnectWallet,
      clearMismatchWarning,
      signTransaction,
      setAuthenticatedSession,
      handleAccountChange,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      {renderToast && showWarningToast && sessionMismatchWarning && (
        <SessionMismatchToast
          warning={sessionMismatchWarning}
          details={mismatchDetails}
          onDismiss={clearMismatchWarning}
          onReauthenticate={onReauthenticate}
        />
      )}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
