'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatAmount, assetLabel } from '@/lib/money';
import { PageContainer } from '@/components/page-container';
import { useOnline } from '@/components/network-status';
import { describeFailure, isAbortError } from '@/lib/network-status';
import { fetchAllPayments } from '@/lib/payments-fetch';
import { RevenueChart } from '@/components/revenue-chart';
import {
  assetOptions,
  buildRevenueSeries,
  buildRouteBreakdown,
  filterByRange,
  UNATTRIBUTED_LABEL,
  type RangeKey,
  type RevenuePayment,
  type RouteBucket,
} from '@/lib/revenue-analytics';

/**
 * Route-level revenue.
 *
 * The honest framing this page has to hold on to: the ledger says how much was
 * paid, and the merchant's own server says which endpoint was bought. Those are
 * different provenances with different trust, and a payment can have the first
 * without the second. Every total below therefore appears twice — once for all
 * revenue in the asset, once for the part Path B can actually explain — and the
 * unattributed remainder is shown rather than quietly excluded.
 */

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

const EMPTY: RevenuePayment[] = [];

type LoadState =
  | { status: 'loading'; loaded: number }
  | { status: 'ready'; payments: RevenuePayment[]; truncated: boolean }
  | { status: 'error'; message: string };

export default function RoutesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading', loaded: 0 });
  const [asset, setAsset] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const online = useOnline();

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    (async () => {
      // Reset to a loading state on (re)connect — the effect also re-runs after
      // the browser comes back online, where the previous view may be an error.
      setState({ status: 'loading', loaded: 0 });
      try {
        // Page through the whole history, not just the newest 1,000 rows: every
        // figure on this page aggregates over a date range, and "All time" has
        // to mean it.
        const { payments, truncated } = await fetchAllPayments({
          signal: controller.signal,
          onProgress: (loaded) => {
            if (!controller.signal.aborted) setState({ status: 'loading', loaded });
          },
        });
        if (!controller.signal.aborted) {
          setState({ status: 'ready', payments, truncated });
        }
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState({ status: 'error', message: describeFailure(error, navigator.onLine) });
        }
      }
    })();
    return () => controller.abort();
  }, [online]);

  // Memoised so the identity is stable: the literal `[]` on the loading and
  // error branches would otherwise be a fresh array on every render, and each
  // aggregation below would recompute for nothing.
  const payments = useMemo(() => (state.status === 'ready' ? state.payments : EMPTY), [state]);

  // The asset selector lists every asset ever earned in, so changing the date
  // range never makes the selected asset disappear — only the figures narrow.
  const assets = useMemo(() => assetOptions(payments), [payments]);
  const inRange = useMemo(() => filterByRange(payments, range), [payments, range]);

  // Default to whichever asset the merchant actually earns in, once known.
  const selectedAsset = asset ?? assets[0]?.key ?? null;

  const breakdown = useMemo(
    () => (selectedAsset ? buildRouteBreakdown(inRange, selectedAsset) : null),
    [inRange, selectedAsset],
  );
  const series = useMemo(
    () => (selectedAsset ? buildRevenueSeries(inRange, { asset: selectedAsset, range }) : null),
    [inRange, selectedAsset, range],
  );

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <PageContainer className="space-y-12">
        <header className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="uppercase tracking-[0.25em] text-emerald-600 dark:text-emerald-400 font-bold text-xs mb-3">
                Analytics
              </p>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
                Revenue by Route
              </h1>
            </div>
            <Link
              href="/dashboard"
              className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              ← Settlements
            </Link>
          </div>

          <p className="text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
            Amounts come from the ledger. Routes come from your server, reported at settlement
            through the SDK — the chain records a transfer, not an endpoint. Revenue with no route
            is shown separately rather than folded in.
          </p>
        </header>

        {state.status === 'loading' && (
          <p
            className="text-sm text-slate-500 dark:text-slate-400 py-12"
            role="status"
            aria-live="polite"
          >
            Loading payment history
            {state.loaded > 0 ? ` — ${state.loaded.toLocaleString()} so far` : '…'}
          </p>
        )}

        {state.status === 'error' && (
          <p className="text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 p-4">
            {state.message}
          </p>
        )}

        {state.status === 'ready' && state.truncated && (
          <p className="text-xs text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 p-3">
            History is unusually large: these figures cover the most recent{' '}
            {payments.length.toLocaleString()} payments, not older ones.
          </p>
        )}

        {state.status === 'ready' && assets.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-12">
            No settled payments indexed yet.
          </p>
        )}

        {selectedAsset && breakdown && series && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {assets.length > 1 && (
                <Segmented
                  options={assets.map((a) => ({ key: a.key, label: `${a.label} (${a.calls})` }))}
                  value={selectedAsset}
                  onChange={setAsset}
                />
              )}
              <Segmented
                options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
                value={range}
                onChange={(next) => setRange(next as RangeKey)}
              />
            </div>

            <section className="grid sm:grid-cols-3 gap-6">
              <Stat
                label="Total settled"
                value={`${formatAmount(breakdown.total)} ${assetLabel(selectedAsset)}`}
                note={`${breakdown.calls} payment${breakdown.calls === 1 ? '' : 's'}`}
              />
              <Stat
                label="Attributed to a route"
                value={`${formatAmount(breakdown.attributedTotal)} ${assetLabel(selectedAsset)}`}
                note={`${breakdown.attributedCalls} of ${breakdown.calls}`}
              />
              <Stat
                label="No attribution"
                value={`${formatAmount(breakdown.unattributedTotal)} ${assetLabel(selectedAsset)}`}
                note={
                  breakdown.unattributedCalls === 0
                    ? 'Every payment is explained'
                    : 'Real transfers, unknown endpoint'
                }
              />
            </section>

            <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white mb-6">
                Over time
              </h2>
              <RevenueChart series={series} />
              {series.unpricedCalls > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                  {series.unpricedCalls} payment{series.unpricedCalls === 1 ? '' : 's'} in range had
                  an unreadable amount and {series.unpricedCalls === 1 ? 'was' : 'were'} counted but
                  not summed.
                </p>
              )}
            </section>

            <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white mb-6">
                By route
              </h2>
              <RouteTable breakdown={breakdown} asset={selectedAsset} />
            </section>
          </>
        )}
      </PageContainer>
    </main>
  );
}

export function RouteTable({
  breakdown,
  asset,
}: {
  breakdown: NonNullable<ReturnType<typeof buildRouteBreakdown>>;
  asset: string;
}) {
  const rows: RouteBucket[] = [
    ...breakdown.routes,
    ...(breakdown.unattributed ? [breakdown.unattributed] : []),
  ];

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Nothing to break down yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Revenue by route breakdown</caption>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 text-left">
            <th scope="col" className="pb-3 pr-4">
              Route
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Calls
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Revenue
            </th>
            <th scope="col" className="pb-3 pr-4 text-right">
              Average
            </th>
            <th scope="col" className="pb-3 w-1/4">
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-t border-slate-100 dark:border-white/5 transition-colors duration-300"
            >
              <td className="py-3 pr-4">
                {row.attributed ? (
                  <span className="font-mono text-slate-900 dark:text-white break-all">
                    <span className="text-emerald-600 dark:text-emerald-400 mr-2">
                      {row.method}
                    </span>
                    {row.route}
                  </span>
                ) : (
                  <span
                    className="text-slate-500 dark:text-slate-400 italic"
                    title="Chain-indexed transfers your server never reported a route for. Real revenue; unknown endpoint."
                  >
                    {UNATTRIBUTED_LABEL}
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                {row.calls}
                {row.unpriced > 0 && (
                  <span
                    className="text-slate-400 dark:text-slate-500"
                    title={`${row.unpriced} had an unreadable amount and were not summed`}
                  >
                    {' '}
                    ({row.unpriced} unpriced)
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-900 dark:text-white font-medium">
                {formatAmount(row.total)} {assetLabel(asset)}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                {row.average === null ? '—' : formatAmount(row.average)}
              </td>
              <td className="py-3">
                <span className="sr-only">{`${Math.round(row.share * 100)}%`}</span>
                <span
                  aria-hidden="true"
                  className="block h-2 bg-slate-100 dark:bg-white/5"
                  title={`${Math.round(row.share * 100)}% of settled revenue in this asset`}
                >
                  <span
                    className={`block h-2 ${
                      row.attributed
                        ? 'bg-emerald-500/80 dark:bg-emerald-400/70'
                        : 'bg-slate-300 dark:bg-white/20'
                    }`}
                    style={{ width: `${Math.max(row.share * 100, row.total === '0' ? 0 : 1)}%` }}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 transition-colors duration-300">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
        {label}
      </p>
      <p className="text-2xl font-black tracking-tight text-slate-900 dark:text-white tabular-nums">
        {value}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{note}</p>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="inline-flex border border-slate-200 dark:border-white/10">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={option.key === value}
          className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${
            option.key === value
              ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
