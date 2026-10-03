'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  getWalletAdapters,
  LAST_WALLET_PROVIDER_KEY,
  type WalletAdapter,
  type WalletStatus,
} from '@/lib/wallet';

const PROVIDERS = getWalletAdapters().filter((adapter) =>
  ['freighter', 'xbull', 'hana'].includes(adapter.providerId ?? ''),
);
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export interface ConnectedWallet {
  provider: string;
  address: string;
}

interface ProviderState {
  adapter: WalletAdapter;
  status: WalletStatus;
}

interface WalletConnectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (wallet: ConnectedWallet) => void;
}

function expectedNetworkPassphrase(): string {
  const configured = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  if (configured) return configured;
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK?.toLowerCase() === 'mainnet'
    ? PUBLIC_PASSPHRASE
    : TESTNET_PASSPHRASE;
}

function readStoredProvider(): string | null {
  try {
    return window.localStorage.getItem(LAST_WALLET_PROVIDER_KEY);
  } catch {
    return null;
  }
}

function storeProvider(providerId: string): void {
  try {
    window.localStorage.setItem(LAST_WALLET_PROVIDER_KEY, providerId);
  } catch {
    // Storage is an enhancement; wallet connection must not depend on it.
  }
}

function statusText(status: WalletStatus): string {
  switch (status.kind) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Installed';
    case 'unavailable':
      return 'Not detected';
    case 'error':
      return 'Could not check';
  }
}

export function WalletConnectModal({
  open,
  onOpenChange,
  onConnected,
}: WalletConnectModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [providerStates, setProviderStates] = useState<ProviderState[]>(() =>
    PROVIDERS.map((adapter) => ({ adapter, status: { kind: 'disconnected' } })),
  );
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferredProvider, setPreferredProvider] = useState<string | null>(null);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const storedProvider = readStoredProvider();
      setPreferredProvider(storedProvider);
      const adapter = PROVIDERS.find((provider) => provider.providerId === storedProvider);
      if (!adapter || !onConnected) return;
      const status = await adapter.readStatus();
      if (active && status.kind === 'connected') {
        onConnected({ provider: adapter.name, address: status.address });
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [onConnected]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferredProvider(readStoredProvider());
    void Promise.all(
      PROVIDERS.map(async (adapter): Promise<ProviderState> => ({
        adapter,
        status: await adapter.readStatus(),
      })),
    )
      .then((states) => {
        if (!active) return;
        setProviderStates(states);
        const connected = states.find(
          (state) => state.status.kind === 'connected' && state.status.networkPassphrase,
        );
        if (
          connected?.status.kind === 'connected' &&
          connected.status.networkPassphrase !== expectedNetworkPassphrase()
        ) {
          setNetworkWarning(
            `This wallet is connected to ${connected.status.network ?? 'a different Stellar network'}. The app is configured for ${process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet'}.`,
          );
        } else {
          setNetworkWarning(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not check wallets');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  async function connect(adapter: WalletAdapter, currentStatus: WalletStatus) {
    setConnecting(adapter.name);
    setError(null);
    try {
      const status = currentStatus.kind === 'connected' ? currentStatus : await adapter.connect();
      if (status.kind !== 'connected') {
        if (status.kind === 'error') setError(status.message);
        else if (status.kind === 'unavailable') setError(`${adapter.name} is not installed.`);
        else setError(`Could not connect to ${adapter.name}.`);
        return;
      }

      const providerId = adapter.providerId ?? adapter.name.toLowerCase();
      storeProvider(providerId);
      setPreferredProvider(providerId);
      setProviderStates((states) =>
        states.map((state) =>
          state.adapter === adapter ? { ...state, status } : state,
        ),
      );
      onConnected?.({ provider: adapter.name, address: status.address });

      if (
        status.networkPassphrase &&
        status.networkPassphrase !== expectedNetworkPassphrase()
      ) {
        setNetworkWarning(
          `Your wallet is connected to ${status.network ?? 'a different Stellar network'}, but this app is configured for ${process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet'}.`,
        );
      } else {
        setNetworkWarning(null);
        onOpenChange(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not connect to ${adapter.name}.`);
    } finally {
      setConnecting(null);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="wallet-dialog-title"
      aria-modal="true"
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      className="m-auto w-[min(100%-2rem,28rem)] border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 dark:border-white/10 dark:bg-[#091119] dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-white/10">
        <div>
          <p className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400">
            Stellar wallet
          </p>
          <h2 id="wallet-dialog-title" className="mt-1 text-xl font-semibold">
            Connect a wallet
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close wallet dialog"
          className="inline-flex size-9 items-center justify-center text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3 p-5">
        {loading && <p role="status" className="text-sm text-slate-500">Checking wallet extensions…</p>}
        {error && (
          <p role="alert" className="border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/5 dark:text-rose-200">
            {error}
          </p>
        )}
        {networkWarning && (
          <p role="alert" className="border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/5 dark:text-amber-100">
            {networkWarning}
          </p>
        )}
        {providerStates.map(({ adapter, status }) => {
          const available = status.kind !== 'unavailable';
          const preferred = preferredProvider === adapter.providerId;
          return (
            <div
              key={adapter.name}
              className="flex items-center justify-between gap-4 border border-slate-200 p-4 dark:border-white/10"
            >
              <div className="min-w-0">
                <p className="font-semibold">{adapter.name}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {loading ? 'Checking…' : statusText(status)}
                  {preferred ? ' · Last used' : ''}
                </p>
              </div>
              {available ? (
                <button
                  type="button"
                  onClick={() => void connect(adapter, status)}
                  disabled={loading || connecting !== null}
                  className="shrink-0 border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                >
                  {connecting === adapter.name
                    ? 'Connecting…'
                    : status.kind === 'connected'
                      ? 'Use wallet'
                      : 'Connect'}
                </button>
              ) : (
                <a
                  href={adapter.installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sm font-semibold text-slate-600 underline underline-offset-4 dark:text-slate-300"
                >
                  Install
                </a>
              )}
            </div>
          );
        })}
      </div>
    </dialog>
  );
}