'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, X } from 'lucide-react';
import { focusRestorer, getFocusable, wrapTabTarget } from '@/lib/dialog-focus';
import { getWalletAdapters, type WalletAdapter, type WalletStatus } from '@/lib/wallet';

const PROVIDER_KEY = 'accensa-wallet-provider';
const WALLET_ADAPTERS = getWalletAdapters().filter((adapter) => adapter.name !== 'Albedo');
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  'Test SDF Network ; September 2015';

function expectedNetwork(): 'TESTNET' | 'PUBLIC' {
  return NETWORK_PASSPHRASE.includes('Public Global Stellar Network') ? 'PUBLIC' : 'TESTNET';
}

function readSavedProvider(): string {
  if (typeof window === 'undefined') return 'Freighter';
  try {
    return localStorage.getItem(PROVIDER_KEY) ?? 'Freighter';
  } catch {
    return 'Freighter';
  }
}

function saveProvider(name: string): void {
  try {
    localStorage.setItem(PROVIDER_KEY, name);
  } catch {
    // Storage can be disabled; wallet selection still works for this visit.
  }
}

function statusLabel(status: WalletStatus | undefined): string {
  if (!status) return 'Checking';
  if (status.kind === 'unavailable') return 'Not detected';
  if (status.kind === 'connected') return 'Connected';
  if (status.kind === 'error') return 'Unavailable';
  return 'Disconnected';
}

export function WalletConnectModal({
  isOpen,
  onClose,
  onConnect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (adapter: WalletAdapter) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [statuses, setStatuses] = useState<Record<string, WalletStatus>>({});
  const [selected, setSelected] = useState('Freighter');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const adapters = WALLET_ADAPTERS;

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const restoreFocus = focusRestorer(previousFocusRef.current);
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();

    let active = true;
    void Promise.resolve().then(() => {
      if (active) setSelected(readSavedProvider());
    });
    void Promise.all(adapters.map(async (adapter) => [adapter.name, await adapter.readStatus()] as const))
      .then((entries) => {
        if (active) setStatuses(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setStatuses({});
      });

    return () => {
      active = false;
      restoreFocus();
    };
  }, [adapters, isOpen]);

  if (!isOpen) return null;

  const expected = expectedNetwork();
  const selectedAdapter = adapters.find((adapter) => adapter.name === selected) ?? adapters[0];

  async function connectSelected(adapter: WalletAdapter) {
    saveProvider(adapter.name);
    setSelected(adapter.name);
    setConnecting(adapter.name);
    setError(null);
    try {
      await onConnect(adapter);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet connection failed');
    } finally {
      setConnecting(null);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const target = wrapTabTarget(
      getFocusable(dialogRef.current),
      document.activeElement as HTMLElement | null,
      event.shiftKey,
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg border border-slate-300 bg-white p-6 text-slate-900 shadow-2xl dark:border-white/15 dark:bg-[#101a1b] dark:text-white sm:p-8"
      >
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
              Stellar Access
            </p>
            <h2 id="wallet-dialog-title" className="text-2xl font-black">
              Choose a wallet
            </h2>
          </div>
          <button
            ref={(node) => {
              if (node) node.dataset.autofocus = 'true';
            }}
            type="button"
            onClick={onClose}
            aria-label="Close wallet chooser"
            className="border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-emerald-500 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <p className="mb-5 border-l-2 border-emerald-500 pl-3 text-sm text-slate-600 dark:text-slate-300">
          This app uses <strong>{expected}</strong>. Confirm the network in your wallet before
          approving.
        </p>

        <div className="divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
          {adapters.map((adapter) => {
            const status = statuses[adapter.name];
            const mismatch =
              status?.kind === 'connected' &&
              status.network !== undefined &&
              status.network.toUpperCase() !== expected;
            return (
              <div key={adapter.name} className="flex items-center gap-3 py-4">
                <button
                  type="button"
                  onClick={() => setSelected(adapter.name)}
                  aria-pressed={selected === adapter.name}
                  className={`min-w-0 flex-1 border-l-2 px-3 py-1 text-left ${selected === adapter.name ? 'border-emerald-500' : 'border-transparent'}`}
                >
                  <span className="block font-bold">{adapter.name}</span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    {statusLabel(status)}
                    {status?.kind === 'connected' ? ` · ${status.address.slice(0, 6)}…` : ''}
                  </span>
                  {mismatch && (
                    <span role="alert" className="mt-1 block text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Wallet network differs from {expected}
                    </span>
                  )}
                </button>
                {status?.kind === 'unavailable' && (
                  <a
                    href={adapter.installUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Install ${adapter.name}`}
                    className="p-2 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300"
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <footer className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:border-white/15 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void connectSelected(selectedAdapter)}
            disabled={connecting !== null}
            className="inline-flex min-w-32 items-center justify-center gap-2 bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {connecting ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            {connecting ? 'Connecting' : 'Connect'}
          </button>
        </footer>
      </div>
    </div>
  );
}