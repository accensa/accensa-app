'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatAmount, assetLabel } from '@/lib/money';
import { PageContainer } from '@/components/page-container';
import { useOnline } from '@/components/network-status';
import { describeFailure, isAbortError } from '@/lib/network-status';
import { RevenueChart } from '@/components/revenue-chart';
import {
  assetOptions,
  buildRevenueSeries,
  buildRouteBreakdown,
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
  | { status: 'loading' }
  | { status: 'ready'; payments: RevenuePayment[] }
  | { status: 'error'; message: string };

export default function RoutesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [asset, setAsset] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const online = useOnline();

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/payments', { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 401) throw new Error('Session expired. Please sign in again.');
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error ?? `Request failed: ${res.status}`);
        }
        const data = await res.json();
        if (!controller.signal.aborted) {
          setState({ status: 'ready', payments: data.payments ?? [] });
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
  const assets = useMemo(() => assetOptions(payments), [payments]);

  // Default to whichever asset the merchant actually earns in, once known.
  const selectedAsset = asset ?? assets[0]?.key ?? null;

  const breakdown = useMemo(
    () => (selectedAsset ? buildRouteBreakdown(payments, selectedAsset) : null),
    [payments, selectedAsset],
  );
  const series = useMemo(
    () => (selectedAsset ? buildRevenueSeries(payments, { asset: selectedAsset, range }) : null),
    [payments, selectedAsset, range],
  );

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <PageContainer className="space-y-12">
        <header className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400 font-bold text-xs mb-3">
                Analytics
              </p>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
                Revenue by Route
              </h1>
            </div>
            <Link
              href="/dashboard"
              className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
            >
              ← Settlements
            </Link>
          </div>

          <p className="text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            Amounts come from the ledger. Routes come from your server, reported at settlement
            through the SDK — the chain records a transfer, not an endpoint. Revenue with no route
            is shown separately rather than folded in.
          </p>
        </header>

        {state.status === 'error' && (
          <p className="text-sm text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 p-4">
            {state.message}
          </p>
        )}

        {state.status === 'ready' && assets.length === 0 && (
          <p className="text-sm text-slate-600 dark:text-slate-300 py-12">
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

            <section className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)]">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white mb-6">
                Over time
              </h2>
              <RevenueChart series={series} />
              {series.unpricedCalls > 0 && (
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-4">
                  {series.unpricedCalls} payment{series.unpricedCalls === 1 ? '' : 's'} in range had
                  an unreadable amount and {series.unpricedCalls === 1 ? 'was' : 'were'} counted but
                  not summed.
                </p>
              )}
            </section>

            <section className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)]">
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
    return <p className="text-sm text-slate-600 dark:text-slate-300">Nothing to break down yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Revenue by route breakdown</caption>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 text-left">
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
                    <span className="text-emerald-700 dark:text-emerald-400 mr-2">
                      {row.method}
                    </span>
                    {row.route}
                  </span>
                ) : (
                  <span
                    className="text-slate-600 dark:text-slate-300 italic"
                    title="Chain-indexed transfers your server never reported a route for. Real revenue; unknown endpoint."
                  >
                    {UNATTRIBUTED_LABEL}
                  </span>
                )}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-300">
                {row.calls}
                {row.unpriced > 0 && (
                  <span
                    className="text-slate-600 dark:text-slate-400"
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
              <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-300">
                {row.average === null ? '—' : formatAmount(row.average)}
              </td>
              <td className="py-3">
                <span className="sr-only">{`${Math.round(row.share * 100)}%`}</span>
                <span
                  aria-hidden="true"
                  className="block h-2 bg-slate-200 dark:bg-white/10"
                  title={`${Math.round(row.share * 100)}% of settled revenue in this asset`}
                >
                  <span
                    className={`block h-2 ${
                      row.attributed
                        ? 'bg-emerald-600 dark:bg-emerald-400'
                        : 'bg-slate-400 dark:bg-slate-500'
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
    <div className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 transition-colors duration-300 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-2">
        {label}
      </p>
      <p className="text-2xl font-black tracking-tight text-slate-900 dark:text-white tabular-nums">
        {value}
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{note}</p>
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
    <div className="inline-flex border border-slate-300 dark:border-white/10">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={option.key === value}
          className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${
            option.key === value
              ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-bold'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
