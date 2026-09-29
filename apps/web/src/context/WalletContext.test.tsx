import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WalletProvider,
  useWallet,
  SessionMismatchToast,
  formatMismatchWarning,
  createSafeSignTransaction,
  registerWalletEventListeners,
} from './WalletContext';
import { type WalletAdapter, type WalletStatus } from '@/lib/wallet';
import { SessionAccountMismatchError } from '@/lib/auth/sessionGuard';

const ACCOUNT_A = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const ACCOUNT_B = 'GBKNGF67M4FBWNCNIFR4LTFXHZD5RDUSMQ5YJL4R7R7N7OXOWLIEMVYV';

function createMockAdapter(overrides?: Partial<WalletAdapter>): WalletAdapter {
  return {
    name: 'MockWallet',
    installUrl: 'https://example.com/install',
    readStatus: vi.fn().mockResolvedValue({ kind: 'disconnected' } as WalletStatus),
    connect: vi.fn().mockResolvedValue({ kind: 'connected', address: ACCOUNT_A } as WalletStatus),
    signTransaction: vi.fn().mockResolvedValue('AAAA-signed-envelope'),
    ...overrides,
  };
}

describe('WalletContext & SessionMismatchToast', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // SessionMismatchToast component
  // ---------------------------------------------------------------------------
  describe('SessionMismatchToast UI & Design System', () => {
    it('renders with role="alert", aria-live="assertive", and accessible structure', () => {
      const html = renderToString(
        <SessionMismatchToast
          warning="Wallet account switched. Session terminated."
          details={{ previousAccount: ACCOUNT_A, newAccount: ACCOUNT_B }}
          onDismiss={() => {}}
          onReauthenticate={() => {}}
        />,
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
      expect(html).toContain('data-testid="session-mismatch-toast"');
      expect(html).toContain('Session Terminated: Wallet Switched');
      expect(html).toContain('Wallet account switched. Session terminated.');
      expect(html).toContain('Re-authenticate');
      expect(html).toContain('Dismiss');
    });

    it('displays truncated addresses for both previous session and active wallet', () => {
      const html = renderToString(
        <SessionMismatchToast
          warning="Switch detected"
          details={{ previousAccount: ACCOUNT_A, newAccount: ACCOUNT_B }}
          onDismiss={() => {}}
        />,
      );

      expect(html).toContain('Previous session: GBRP…OX2H');
      expect(html).toContain('Active wallet: GBKN…MVYV');
    });

    it('strictly conforms to Accensa sharp-corner design standard (no rounded-* classes)', () => {
      const html = renderToString(
        <SessionMismatchToast
          warning="Design system test"
          details={{ previousAccount: ACCOUNT_A, newAccount: ACCOUNT_B }}
          onDismiss={() => {}}
        />,
      );

      // No rounded corners allowed in Accensa design system
      expect(html).not.toContain('rounded-lg');
      expect(html).not.toContain('rounded-full');
      expect(html).not.toContain('rounded-md');
      expect(html).not.toContain('rounded-sm');
      expect(html).not.toContain('rounded-xl');
    });
  });

  // ---------------------------------------------------------------------------
  // formatMismatchWarning
  // ---------------------------------------------------------------------------
  describe('formatMismatchWarning', () => {
    it('formats message when switching to another account', () => {
      const msg = formatMismatchWarning(ACCOUNT_A, ACCOUNT_B);
      expect(msg).toContain('Your wallet account switched to GBKN…MVYV');
      expect(msg).toContain('Your active session for GBRP…OX2H was terminated for security');
    });

    it('formats message when wallet disconnects while session is active', () => {
      const msg = formatMismatchWarning(ACCOUNT_A, null);
      expect(msg).toContain(
        'Your wallet disconnected while an active session for GBRP…OX2H was open',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Hook usage error
  // ---------------------------------------------------------------------------
  describe('useWallet guard', () => {
    it('throws when useWallet is invoked outside a WalletProvider', () => {
      function Consumer() {
        useWallet();
        return null;
      }

      expect(() => renderToString(<Consumer />)).toThrow(
        'useWallet must be used within a WalletProvider',
      );
    });

    it('renders children within WalletProvider', () => {
      const html = renderToString(
        <WalletProvider initialAccount={ACCOUNT_A} initialSessionAccount={ACCOUNT_A}>
          <div data-testid="dashboard-content">Dashboard Protected Area</div>
        </WalletProvider>,
      );

      expect(html).toContain('Dashboard Protected Area');
    });
  });

  // ---------------------------------------------------------------------------
  // Transaction Signing Safety Guard
  // ---------------------------------------------------------------------------
  describe('createSafeSignTransaction Safety Guard', () => {
    it('signs successfully when active wallet account matches authenticated session', async () => {
      const mockAdapter = createMockAdapter();
      const safeSign = createSafeSignTransaction(mockAdapter, ACCOUNT_A, ACCOUNT_A);

      const result = await safeSign('AAAA-unsigned', {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: ACCOUNT_A,
      });

      expect(result).toBe('AAAA-signed-envelope');
      expect(mockAdapter.signTransaction).toHaveBeenCalledWith('AAAA-unsigned', {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: ACCOUNT_A,
      });
    });

    it('blocks signing with SessionAccountMismatchError when wallet account differs from session', async () => {
      const mockAdapter = createMockAdapter();
      const safeSign = createSafeSignTransaction(mockAdapter, ACCOUNT_A, ACCOUNT_B);

      await expect(
        safeSign('AAAA-unsigned', {
          networkPassphrase: 'Test SDF Network ; September 2015',
          address: ACCOUNT_A,
        }),
      ).rejects.toThrow(SessionAccountMismatchError);

      expect(mockAdapter.signTransaction).not.toHaveBeenCalled();
    });

    it('blocks signing when target address in options does not match active wallet', async () => {
      const mockAdapter = createMockAdapter();
      const safeSign = createSafeSignTransaction(mockAdapter, ACCOUNT_A, ACCOUNT_A);

      await expect(
        safeSign('AAAA-unsigned', {
          networkPassphrase: 'Test SDF Network ; September 2015',
          address: ACCOUNT_B,
        }),
      ).rejects.toThrow(/Target address/);

      expect(mockAdapter.signTransaction).not.toHaveBeenCalled();
    });

    it('blocks signing when no wallet account is active', async () => {
      const mockAdapter = createMockAdapter();
      const safeSign = createSafeSignTransaction(mockAdapter, ACCOUNT_A, null);

      await expect(
        safeSign('AAAA-unsigned', {
          networkPassphrase: 'Test SDF Network ; September 2015',
        }),
      ).rejects.toThrow(SessionAccountMismatchError);

      expect(mockAdapter.signTransaction).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Wallet Extension Event Emitter Integration (Freighter, xBull, Hana, CustomEvents)
  // ---------------------------------------------------------------------------
  describe('registerWalletEventListeners', () => {
    it('subscribes to window and provider accountChanged events and cleans up properly', () => {
      const windowListeners = new Map<string, (e: unknown) => void>();
      const providerListeners = new Map<string, (e: unknown) => void>();
      const changedSpy = vi.fn();
      const focusSpy = vi.fn();

      const fakeFreighter = {
        on: vi.fn((event: string, cb: (data: unknown) => void) => {
          providerListeners.set(`freighter:${event}`, cb);
        }),
        removeListener: vi.fn(),
      };
      const fakeXBull = {
        on: vi.fn((event: string, cb: (data: unknown) => void) => {
          providerListeners.set(`xbull:${event}`, cb);
        }),
        removeListener: vi.fn(),
      };
      const fakeHana = {
        on: vi.fn((event: string, cb: (data: unknown) => void) => {
          providerListeners.set(`hana:${event}`, cb);
        }),
        removeListener: vi.fn(),
      };

      vi.stubGlobal('window', {
        addEventListener: vi.fn((event: string, cb: (e: unknown) => void) => {
          windowListeners.set(event, cb);
        }),
        removeEventListener: vi.fn(),
        freighter: fakeFreighter,
        xBullSDK: fakeXBull,
        hanaWallet: fakeHana,
      });

      const cleanup = registerWalletEventListeners(changedSpy, focusSpy);

      // Verify listeners attached
      expect(fakeFreighter.on).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(fakeXBull.on).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(fakeHana.on).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith(
        'freighter:accountChanged',
        expect.any(Function),
      );
      expect(window.addEventListener).toHaveBeenCalledWith(
        'stellar:accountChanged',
        expect.any(Function),
      );
      expect(window.addEventListener).toHaveBeenCalledWith(
        'accensa:account-changed',
        expect.any(Function),
      );
      expect(window.addEventListener).toHaveBeenCalledWith('focus', expect.any(Function));

      // Trigger Freighter account change
      providerListeners.get('freighter:accountChanged')?.({ address: ACCOUNT_B });
      expect(changedSpy).toHaveBeenCalledWith(ACCOUNT_B);

      // Trigger xBull account change with publicKey object
      providerListeners.get('xbull:accountChanged')?.({ publicKey: ACCOUNT_A });
      expect(changedSpy).toHaveBeenCalledWith(ACCOUNT_A);

      // Trigger Hana account change with string
      providerListeners.get('hana:accountChanged')?.(ACCOUNT_B);
      expect(changedSpy).toHaveBeenCalledWith(ACCOUNT_B);

      // Trigger Window CustomEvent
      windowListeners.get('accountChanged')?.({ detail: { address: ACCOUNT_A } });
      expect(changedSpy).toHaveBeenCalledWith(ACCOUNT_A);

      // Trigger focus
      windowListeners.get('focus')?.({});
      expect(focusSpy).toHaveBeenCalled();

      // Cleanup
      cleanup();
      expect(fakeFreighter.removeListener).toHaveBeenCalledWith(
        'accountChanged',
        expect.any(Function),
      );
      expect(fakeXBull.removeListener).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(fakeHana.removeListener).toHaveBeenCalledWith('accountChanged', expect.any(Function));
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'accountChanged',
        expect.any(Function),
      );
      expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    });
  });
});
