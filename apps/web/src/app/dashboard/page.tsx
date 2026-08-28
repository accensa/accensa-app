'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatAmount, sumAmounts, assetLabel } from '@/lib/money';
import { describeSync, type SyncState } from '@/lib/sync-status';
import { CSV_BOM, paymentsCsvFilename, paymentsToCsv } from '@/lib/payments-csv';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageContainer } from '@/components/page-container';
import { RefundPanel } from '@/components/refund-panel';
import { CopyButton } from '@/components/copy-button';
import { useOnline } from '@/components/network-status';
import { describeFailure, isAbortError } from '@/lib/network-status';
import { explorerTxUrl } from '@/lib/explorer';
import { focusRestorer, getFocusable, wrapTabTarget } from '@/lib/dialog-focus';

interface Payment {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; payments: Payment[]; fetchedAt: number; sync: SyncState | null }
  | { status: 'error'; message: string };

const POLL_INTERVAL_MS = 15_000;

function truncate(value: string, head = 8, tail = 6) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const REFUNDED_STORAGE_KEY = 'accensa-refunded-txs';

function loadRefundedFromStorage(): ReadonlySet<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(REFUNDED_STORAGE_KEY);
    if (!stored) return new Set();
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveRefundedToStorage(refunded: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(REFUNDED_STORAGE_KEY, JSON.stringify([...refunded]));
  } catch {
    // localStorage may be full or unavailable; silently degrade.
  }
}

export default function Dashboard() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selected, setSelected] = useState<Payment | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Refunds issued in this session. The indexer does not watch RefundVault
  // events yet, so a refund is otherwise invisible until someone opens the
  // payment again and the contract is re-read.
  const [refunded, setRefunded] = useState<ReadonlySet<string>>(() => new Set());
  const markRefunded = useCallback(
    (txHash: string) => setRefunded((prev) => new Set(prev).add(txHash)),
    [],
  );
  // Stable identity: PaymentModal's focus-management effect depends on it, and a
  // fresh closure every render (the dashboard re-renders on every 15s poll)
  // would re-trap focus mid-interaction.
  const closeModal = useCallback(() => setSelected(null), []);
  const online = useOnline();

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  // `online` is a dependency, not just a guard: polling stops while the browser
  // has no connection - every request would fail and overwrite a good table with
  // an error - and reconnecting re-runs the effect, which refetches immediately
  // rather than waiting out the remainder of a 15s tick.
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    async function fetchPayments() {
      try {
        const res = await fetch('/api/payments', { signal: controller.signal, cache: 'no-store' });
        if (!res.ok)
          throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
        const data = await res.json();
        // Tolerate both shapes: the endpoint used to return a bare array, and
        // a deploy can briefly serve an older build to an already-open tab.
        const payments: Payment[] = Array.isArray(data) ? data : (data.payments ?? []);
        const sync: SyncState | null = Array.isArray(data) ? null : (data.sync ?? null);
        if (!controller.signal.aborted) {
          setState({ status: 'ready', payments, fetchedAt: Date.now(), sync });
        }
      } catch (error) {
        // Re-read navigator.onLine here rather than closing over `online`: the
        // connection can drop between the request going out and it failing,
        // and that is exactly the case worth naming correctly.
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState({ status: 'error', message: describeFailure(error, navigator.onLine) });
        }
      }
    }
    void fetchPayments();
    const timer = setInterval(fetchPayments, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [reloadToken, online]);

  const payments = state.status === 'ready' ? state.payments : [];
  const total = sumAmounts(payments.map((p) => p.amount));
  const assets = new Set(payments.map((p) => assetLabel(p.asset)));
  const totalAsset = assets.size === 1 ? [...assets][0] : '';

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <PageContainer className="space-y-12">
        {/* Header Grid */}
        <header className="grid lg:grid-cols-3 gap-8 items-end">
          <div className="lg:col-span-2 space-y-6 text-center lg:text-left">
            <div>
              <p className="uppercase tracking-[0.25em] text-emerald-600 dark:text-emerald-400 font-bold text-xs mb-3">
                Dashboard
              </p>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
                Settled Volume
              </h1>
              <Link
                href="/dashboard/routes"
                className="inline-block mt-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                Revenue by route →
              </Link>
            </div>
          </div>

          <div className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-8 flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden transition-colors duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[40px] dark:blur-[50px] pointer-events-none" />
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              Total Settled
            </span>
            <span className="text-4xl sm:text-5xl font-black tracking-tighter mt-4 flex items-baseline gap-2 text-slate-900 dark:text-white transition-colors duration-300">
              {state.status === 'loading' ? (
                <span className="block h-12 w-32 bg-slate-100 dark:bg-white/5 animate-pulse" />
              ) : (
                <>
                  {formatAmount(total)}
                  {totalAsset && (
                    <span className="text-2xl text-emerald-600 dark:text-emerald-400 font-bold">
                      {totalAsset}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        </header>

        {/* Data Table Section */}
        <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
          <div className="px-8 py-6 flex justify-between items-center bg-white/30 dark:bg-black/30 backdrop-blur-xl transition-colors duration-300">
            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
              Recent Settlements
            </h2>
            <div className="flex items-center gap-4">
              <StatusPill state={state} onRetry={reload} />
              <ExportCsvButton payments={payments} />
              <SyncNowButton onSynced={reload} />
            </div>
          </div>

          <div className="min-h-[400px]">
            {state.status === 'loading' && <TableSkeleton />}

            {state.status === 'error' && (
              <div className="flex flex-col items-center justify-center h-[400px] text-center space-y-4 px-6">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-500/10 flex items-center justify-center text-red-600 dark:text-red-400 mb-2">
                  ✕
                </div>
                <p className="text-xl font-black tracking-tighter text-slate-900 dark:text-white">
                  Connection Error
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md">
                  {state.message}
                </p>
                <button
                  onClick={reload}
                  className="mt-4 px-6 py-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-bold hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors shadow-sm dark:shadow-none"
                >
                  Try Again
                </button>
              </div>
            )}

            {state.status === 'ready' && payments.length === 0 && (
              <div className="flex flex-col items-center justify-center h-[400px] text-center space-y-4 px-6">
                <div className="w-12 h-12 bg-emerald-400 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2 animate-pulse">
                  ●
                </div>
                <p className="text-xl font-black tracking-tighter text-slate-900 dark:text-white">
                  Awaiting Data
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm">
                  Payments settled to this merchant address will appear here automatically.
                </p>
              </div>
            )}

            {state.status === 'ready' && payments.length > 0 && (
              <>
                {/* Mobile View */}
                <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
                  {payments.map((payment) => (
                    <div
                      key={payment.tx_hash}
                      onClick={() => setSelected(payment)}
                      className="p-6 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer group flex flex-col gap-4"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-black text-2xl tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                            {formatAmount(payment.amount)}
                          </span>
                          <span className="text-slate-400 dark:text-slate-500 ml-2 text-xs font-bold">
                            {assetLabel(payment.asset)}
                          </span>
                        </div>
                        <div className="text-slate-500 text-xs text-right mt-1">
                          {new Date(payment.ts).toLocaleString()}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Transaction
                          </p>
                          <p className="font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                            {truncate(payment.tx_hash)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Payer
                          </p>
                          <p className="font-mono text-slate-500 dark:text-slate-400 text-sm">
                            {truncate(payment.payer, 4, 4)}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                            Route
                          </p>
                          {payment.route ? (
                            <div className="inline-flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 px-2.5 py-1 text-sm transition-colors duration-300">
                              {payment.method && (
                                <span className="text-emerald-600 dark:text-emerald-500/70 font-mono font-bold text-xs">
                                  {payment.method}
                                </span>
                              )}
                              <span className="font-mono text-slate-600 dark:text-slate-300">
                                {payment.route}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-600">-</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop View */}
                <div className="hidden md:block overflow-x-auto">
                  <PaymentsTable payments={payments} refunded={refunded} onSelect={setSelected} />
                </div>
              </>
            )}
          </div>
        </section>
      </PageContainer>

      {/* Modal Dialog */}
      {selected && (
        <PaymentModal
          selected={selected}
          onClose={closeModal}
          refunded={refunded}
          onRefunded={markRefunded}
        />
      )}
    </main>
  );
}

const PAYMENT_MODAL_HEADING_ID = 'payment-details-heading';

export function PaymentModal({
  selected,
  onClose,
  refunded,
  onRefunded,
}: {
  selected: Payment;
  onClose: () => void;
  refunded: ReadonlySet<string>;
  onRefunded: (tx_hash: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // A real modal dialog: focus moves in on open, Tab is trapped inside, Escape
  // and a backdrop click both close, and focus returns to whatever opened it.
  useEffect(() => {
    const restoreFocus = focusRestorer(
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
    );

    const dialog = dialogRef.current;
    if (dialog) {
      const focusable = getFocusable(dialog);
      (focusable[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialog) {
        const target = wrapTabTarget(
          getFocusable(dialog),
          document.activeElement as HTMLElement | null,
          event.shiftKey,
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#04090f]/40 dark:bg-black/80 backdrop-blur-sm transition-colors duration-300"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PAYMENT_MODAL_HEADING_ID}
        tabIndex={-1}
        className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-slate-200 dark:border-white/10 w-full max-w-lg overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_0_50px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] animate-in zoom-in-95 duration-200 transition-colors duration-300 max-h-[90vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 md:px-8 md:py-6 border-b border-slate-200/60 dark:border-white/20 flex justify-between items-center bg-slate-50 dark:bg-[#0a111a] transition-colors duration-300 shrink-0">
          <div className="flex items-center gap-2">
            <h3
              id={PAYMENT_MODAL_HEADING_ID}
              className="text-lg font-black tracking-tight text-slate-900 dark:text-white transition-colors duration-300"
            >
              Payment Details
            </h3>
            {refunded.has(selected.tx_hash) && (
              <span
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 align-middle"
                title="Refunded from the vault in this session"
              >
                Refunded
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment details"
            className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-6 md:p-8 space-y-6 md:space-y-8 overflow-y-auto">
          <Field
            label="Transaction Hash"
            action={<CopyButton value={selected.tx_hash} label="Transaction Hash" />}
          >
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-400 dark:border-emerald-500/20 px-4 py-3 font-mono text-xs text-emerald-600 dark:text-emerald-400 break-all transition-colors duration-300">
              {selected.tx_hash}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-8">
            <Field label="Amount">
              <span className="text-3xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
                {formatAmount(selected.amount)}{' '}
                <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 transition-colors duration-300">
                  {assetLabel(selected.asset)}
                </span>
              </span>
            </Field>
            <Field label="Ledger">
              <span className="font-mono text-slate-500 dark:text-slate-300 text-lg transition-colors duration-300">
                {selected.ledger ?? '-'}
              </span>
            </Field>
          </div>
          <Field label="Payer" action={<CopyButton value={selected.payer} label="Payer Address" />}>
            <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300 break-all transition-colors duration-300">
              {selected.payer}
            </div>
          </Field>
          <Field label="Timestamp">
            <span className="text-slate-600 dark:text-slate-300 transition-colors duration-300">
              {new Date(selected.ts).toLocaleString()}
            </span>
          </Field>

          <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
            <a
              href={explorerTxUrl(selected.tx_hash)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20 shadow-sm dark:shadow-none transition-all font-bold text-sm tracking-wide uppercase"
            >
              View on Explorer <ArrowUpRight className="w-4 h-4 opacity-70" />
            </a>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
              Refund
            </p>
            <RefundPanel payment={selected} onRefunded={onRefunded} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PaymentsTable({
  payments,
  refunded,
  onSelect,
}: {
  payments: Payment[];
  refunded: ReadonlySet<string>;
  onSelect: (payment: Payment) => void;
}) {
  return (
    <table className="w-full text-left border-collapse whitespace-nowrap">
      <caption className="sr-only">Recent Settlements</caption>
      <thead>
        <tr className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-slate-100 dark:border-white/5 bg-white dark:bg-[#04090f]/50 transition-colors duration-300">
          <th scope="col" className="px-8 py-5">
            Transaction
          </th>
          <th scope="col" className="px-8 py-5">
            Amount
          </th>
          <th scope="col" className="px-8 py-5">
            Payer
          </th>
          <th scope="col" className="px-8 py-5">
            Route
          </th>
          <th scope="col" className="px-8 py-5">
            Time
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
        {payments.map((payment) => (
          <tr
            key={payment.tx_hash}
            onClick={() => onSelect(payment)}
            className="hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer group"
          >
            <td className="px-8 py-5 font-mono text-emerald-600 dark:text-emerald-400 text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">
              {truncate(payment.tx_hash)}
              {refunded.has(payment.tx_hash) && (
                <span
                  className="ml-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 align-middle"
                  title="Refunded from the vault in this session"
                >
                  Refunded
                </span>
              )}
            </td>
            <td className="px-8 py-5">
              <span className="font-black text-lg tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                {formatAmount(payment.amount)}
              </span>
              <span className="text-slate-400 dark:text-slate-500 ml-2 text-xs font-bold">
                {assetLabel(payment.asset)}
              </span>
            </td>
            <td className="px-8 py-5 font-mono text-slate-500 dark:text-slate-400 text-sm transition-colors duration-300">
              {truncate(payment.payer, 4, 4)}
            </td>
            <td className="px-8 py-5">
              {payment.route ? (
                <div className="inline-flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 px-2.5 py-1 text-sm transition-colors duration-300">
                  {payment.method && (
                    <span className="text-emerald-600 dark:text-emerald-500/70 font-mono font-bold text-xs">
                      {payment.method}
                    </span>
                  )}
                  <span className="font-mono text-slate-600 dark:text-slate-300">
                    {payment.route}
                  </span>
                </div>
              ) : (
                <span className="text-slate-400 dark:text-slate-600">-</span>
              )}
            </td>
            <td className="px-8 py-5 text-slate-500 dark:text-slate-400 text-sm">
              {new Date(payment.ts).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest transition-colors duration-300">
          {label}
        </span>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function StatusPill({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
  if (state.status === 'loading')
    return (
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 animate-pulse transition-colors duration-300">
        Syncing...
      </span>
    );
  if (state.status === 'error')
    return (
      <button
        onClick={onRetry}
        className="flex gap-2 items-center text-xs font-bold uppercase tracking-widest text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
      >
        <span className="w-2 h-2 bg-red-500" /> Retry Connection
      </button>
    );
  // Deliberately reports the indexer's timestamp, not state.fetchedAt. The poll
  // succeeding says nothing about how current the data behind it is, and the
  // sync job lands every 1-3 hours in practice.
  const { level, age, detail } = describeSync(state.sync);

  const tone = {
    live: 'text-emerald-600 dark:text-emerald-400',
    lagging: 'text-amber-600 dark:text-amber-400',
    stale: 'text-red-600 dark:text-red-400',
    unknown: 'text-slate-500 dark:text-slate-400',
  }[level];

  const dot = {
    live: 'bg-emerald-500',
    lagging: 'bg-amber-500',
    stale: 'bg-red-500',
    unknown: 'bg-slate-400',
  }[level];

  const label = {
    live: `Live · synced ${age} ago`,
    lagging: `Synced ${age} ago`,
    stale: `Stale · ${age} old`,
    unknown: 'Sync time unknown',
  }[level];

  return (
    <span
      title={detail}
      className={`flex gap-2 items-center text-[10px] font-bold uppercase tracking-widest transition-colors duration-300 ${tone}`}
    >
      <span className="relative flex h-2 w-2">
        {/* The ping animation claims activity; only show it when that is true. */}
        {level === 'live' && (
          <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75" />
        )}
        <span className={`relative inline-flex h-2 w-2 ${dot}`} />
      </span>
      <span className="sr-only">{detail}</span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

type SyncPhase =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; message: string }
  | { phase: 'cooldown'; until: number }
  | { phase: 'error'; message: string };

/**
 * Runs the indexer on demand.
 *
 * The scheduled sync is nominally every 5 minutes but GitHub drops most of
 * those runs, so in practice the dashboard can sit hours behind with no way to
 * catch up. This posts to /api/sync, which enforces its own cooldown - the
 * button reflects that, it does not enforce it.
 */
function SyncNowButton({ onSynced }: { onSynced: () => void }) {
  const [state, setState] = useState<SyncPhase>({ phase: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const online = useOnline();

  // Expiry is derived, not stored: a timer that writes state back on every tick
  // would re-render the whole header once a second for no benefit.
  const cooling = state.phase === 'cooldown' && now < state.until;

  // Tick only while counting down. When `cooling` flips false the effect
  // re-runs, returns early, and the interval is cleared.
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  // Clear a result message after a few seconds so it does not read as current.
  useEffect(() => {
    if (state.phase !== 'done' && state.phase !== 'error') return;
    const timer = setTimeout(() => setState({ phase: 'idle' }), 6000);
    return () => clearTimeout(timer);
  }, [state.phase]);

  const trigger = useCallback(async () => {
    setState({ phase: 'running' });
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));

      if (res.status === 429) {
        setState({ phase: 'cooldown', until: Date.now() + (data.retryAfterMs ?? 60_000) });
        return;
      }
      if (!res.ok || data.success === false) {
        setState({ phase: 'error', message: data.error ?? `Error ${res.status}` });
        return;
      }

      const inserted = data.inserted ?? 0;
      setState({
        phase: 'done',
        message:
          inserted > 0 ? `Indexed ${inserted} payment${inserted === 1 ? '' : 's'}` : 'Up to date',
      });
      // Refresh the table even when nothing was inserted - the sync timestamp
      // moved, and the pill reads from that.
      onSynced();
    } catch (error) {
      setState({ phase: 'error', message: error instanceof Error ? error.message : 'Failed' });
    }
  }, [onSynced]);

  const secondsLeft =
    state.phase === 'cooldown' ? Math.max(0, Math.ceil((state.until - now) / 1000)) : 0;
  // Offline is a hard disable: the POST cannot reach the indexer, and letting
  // it fail would burn the server-side cooldown on a request that never left
  // the browser - the merchant would then be told to wait before retrying
  // something that never ran.
  const disabled = state.phase === 'running' || cooling || !online;

  const label = !online
    ? 'Offline'
    : state.phase === 'running'
      ? 'Syncing…'
      : state.phase === 'done'
        ? state.message
        : state.phase === 'error'
          ? 'Retry sync'
          : cooling
            ? `Wait ${secondsLeft}s`
            : 'Sync now';

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={disabled}
      title={
        !online
          ? 'No connection. Reconnect to trigger a sync.'
          : state.phase === 'error'
            ? state.message
            : state.phase === 'cooldown'
              ? 'A sync ran moments ago. The indexer is rate limited to avoid hammering the network.'
              : 'Index new payments now instead of waiting for the scheduled run'
      }
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer disabled:cursor-not-allowed ${
        state.phase === 'error'
          ? 'border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent'
      }`}
    >
      <span aria-live="polite">{label}</span>
    </button>
  );
}

/**
 * Downloads the payment history the table is showing as a CSV file.
 *
 * Exports what is on screen rather than re-fetching: /api/payments is already
 * the whole set the dashboard has (newest 100), and re-requesting would mean
 * the file could disagree with the rows the merchant was looking at.
 *
 * Serialization lives in lib/payments-csv so it can be tested without a DOM;
 * this only turns the text into a download.
 */
function ExportCsvButton({ payments }: { payments: Payment[] }) {
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(() => {
    try {
      // The BOM is what makes Excel read the file as UTF-8.
      const blob = new Blob([CSV_BOM + paymentsToCsv(payments)], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = paymentsCsvFilename();
      link.click();
      // Safari needs the click to have been dispatched before the object URL
      // goes away, so revoke on the next frame rather than immediately.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  }, [payments]);

  const empty = payments.length === 0;

  return (
    <button
      type="button"
      onClick={download}
      disabled={empty}
      title={
        error
          ? error
          : empty
            ? 'Nothing to export yet'
            : `Download these ${payments.length} payment${payments.length === 1 ? '' : 's'} as CSV`
      }
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer disabled:cursor-not-allowed ${
        error
          ? 'border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent'
      }`}
    >
      <span aria-live="polite">{error ? 'Export failed' : 'Export CSV'}</span>
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="p-8 space-y-4">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="h-12 bg-slate-100 dark:bg-white/5 animate-pulse transition-colors duration-300"
        />
      ))}
    </div>
  );
}
