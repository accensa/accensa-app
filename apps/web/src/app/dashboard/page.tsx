'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Inter } from 'next/font/google';
import { formatAmount, sumAmounts, assetLabel } from '@/lib/money';

const inter = Inter({ subsets: ['latin'] });

interface Payment {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  /** Decimal string, never a number — see src/lib/money.ts. */
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; payments: Payment[]; fetchedAt: number }
  | { status: 'error'; message: string };

const POLL_INTERVAL_MS = 15_000;

const explorerUrl = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;

function truncate(value: string, head = 8, tail = 6) {
  return value.length <= head + tail + 1
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export default function Dashboard() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<Payment | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Bumped to trigger an out-of-band refetch (the Retry button).
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchPayments() {
      try {
        const res = await fetch('/api/payments', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Indexer responded ${res.status}`);
        }
        const data: Payment[] = await res.json();
        if (controller.signal.aborted) return;
        setState({ status: 'ready', payments: data, fetchedAt: Date.now() });
      } catch (error) {
        if (controller.signal.aborted) return;
        // Surface the failure rather than silently showing invented data.
        setState({
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to reach the indexer',
        });
      }
    }

    void fetchPayments();
    const timer = setInterval(fetchPayments, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reloadToken]);

  // Dismiss the details dialog with Escape, and move focus into it on open.
  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const payments = state.status === 'ready' ? state.payments : [];
  const total = sumAmounts(payments.map((p) => p.amount));
  const assets = new Set(payments.map((p) => assetLabel(p.asset)));
  const totalAsset = assets.size === 1 ? [...assets][0] : '';

  return (
    <main
      className={`min-h-screen bg-[#0a0a0a] text-white p-8 md:p-24 ${inter.className}`}
    >
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-600/20 blur-[120px]" />
      </div>

      <div className="max-w-6xl mx-auto space-y-12">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
              Accensa
            </h1>
            <p className="text-gray-400 mt-2">
              Payments settled on Stellar, indexed from the ledger.
            </p>
          </div>

          <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-6 flex flex-col min-w-[240px] shadow-2xl">
            <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Total settled
            </span>
            <span className="text-4xl font-light mt-2 flex items-baseline gap-2">
              {state.status === 'loading' ? (
                <span className="inline-block h-9 w-32 rounded bg-white/10 animate-pulse" />
              ) : (
                <>
                  {formatAmount(total)}
                  {totalAsset && (
                    <span className="text-lg text-gray-500">{totalAsset}</span>
                  )}
                </>
              )}
            </span>
          </div>
        </header>

        <section className="bg-white/5 border border-white/10 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl">
          <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center gap-4 flex-wrap">
            <h2 className="text-xl font-semibold">Settlements</h2>
            <StatusPill state={state} onRetry={reload} />
          </div>

          {state.status === 'loading' && <TableSkeleton />}

          {state.status === 'error' && (
            <div className="px-8 py-12 text-center space-y-3">
              <p className="text-amber-400 font-medium">Could not load payments</p>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                {state.message}
              </p>
              <button
                onClick={reload}
                className="mt-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {state.status === 'ready' && payments.length === 0 && (
            <div className="px-8 py-16 text-center space-y-3">
              <p className="text-gray-300 font-medium">No payments yet</p>
              <p className="text-gray-500 text-sm max-w-md mx-auto">
                Once a payment settles to this merchant address, the indexer picks
                it up from the ledger and it appears here.
              </p>
            </div>
          )}

          {state.status === 'ready' && payments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-gray-400 text-sm border-b border-white/10">
                    <th className="px-8 py-4 font-medium">Transaction</th>
                    <th className="px-8 py-4 font-medium">Amount</th>
                    <th className="px-8 py-4 font-medium">Payer</th>
                    <th className="px-8 py-4 font-medium">Route</th>
                    <th className="px-8 py-4 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {payments.map((payment) => (
                    <tr
                      key={payment.tx_hash}
                      onClick={() => setSelected(payment)}
                      className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                    >
                      <td className="px-8 py-5 font-mono text-emerald-300 text-sm">
                        {truncate(payment.tx_hash)}
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-semibold text-lg">
                          {formatAmount(payment.amount)}
                        </span>
                        <span className="text-gray-500 ml-1 text-sm">
                          {assetLabel(payment.asset)}
                        </span>
                      </td>
                      <td className="px-8 py-5 font-mono text-gray-400 text-sm">
                        {truncate(payment.payer, 4, 4)}
                      </td>
                      <td className="px-8 py-5 text-gray-400 text-sm">
                        {payment.route ? (
                          <span className="font-mono">
                            {payment.method && (
                              <span className="text-gray-500 mr-1">
                                {payment.method}
                              </span>
                            )}
                            {payment.route}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-gray-400 text-sm">
                        {new Date(payment.ts).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-details-title"
            className="bg-[#111111] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <h3
                id="payment-details-title"
                className="text-lg font-semibold text-emerald-400"
              >
                Payment details
              </h3>
              <button
                ref={closeButtonRef}
                onClick={() => setSelected(null)}
                aria-label="Close payment details"
                className="text-gray-400 hover:text-white transition-colors rounded px-2"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-6">
              <Field label="Transaction hash">
                <span className="font-mono text-sm break-all">
                  {selected.tx_hash}
                </span>
              </Field>
              <div className="grid grid-cols-2 gap-6">
                <Field label="Amount">
                  <span className="text-2xl font-semibold text-emerald-400">
                    {formatAmount(selected.amount)}{' '}
                    <span className="text-sm font-normal text-gray-500">
                      {assetLabel(selected.asset)}
                    </span>
                  </span>
                </Field>
                <Field label="Ledger">
                  <span className="font-mono text-sm">{selected.ledger ?? '—'}</span>
                </Field>
              </div>
              <Field label="Payer">
                <span className="font-mono text-sm break-all">{selected.payer}</span>
              </Field>
              {selected.route && (
                <Field label="Route">
                  <span className="font-mono text-sm">
                    {selected.method} {selected.route}
                  </span>
                </Field>
              )}
              <Field label="Settled at">
                <span className="text-sm">
                  {new Date(selected.ts).toLocaleString()}
                </span>
              </Field>
              <div className="pt-4 border-t border-white/10">
                <a
                  href={explorerUrl(selected.tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full text-center py-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors font-medium text-sm border border-emerald-500/20"
                >
                  View on Stellar Expert ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </span>
      <div className="text-gray-300">{children}</div>
    </div>
  );
}

function StatusPill({
  state,
  onRetry,
}: {
  state: LoadState;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return <span className="text-xs text-gray-500">Loading…</span>;
  }
  if (state.status === 'error') {
    return (
      <button
        onClick={onRetry}
        className="flex gap-2 items-center text-xs text-amber-400"
      >
        <span className="inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
        Indexer unreachable — retry
      </button>
    );
  }
  return (
    <span className="flex gap-2 items-center text-xs text-emerald-400">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
      </span>
      Live · updated {new Date(state.fetchedAt).toLocaleTimeString()}
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="px-8 py-6 space-y-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}
