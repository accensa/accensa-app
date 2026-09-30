'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/page-container';
import { useOnline } from '@/components/network-status';
import { describeFailure, isAbortError } from '@/lib/network-status';
import { fetchAllPayments } from '@/lib/payments-fetch';
import { GasExpenditureChart } from '@/components/analytics/GasExpenditureChart';
import {
  aggregateGasFees,
  formatFeeToVolumeRatio,
  gasCsvExport,
  gasCsvFilename,
  parseGasFeeLogEntry,
  STELLAR_BASE_FEE_STROOPS,
  stroopsToXlm,
  traditionalCardFeeForVolume,
  type GasFeeLogEntry,
} from '@/lib/analytics/gasCalculator';

/**
 * Gas & network fee expenditure analytics (#435).
 *
 * Shows what Stellar network fees actually cost the merchant: total spent,
 * the average per transaction, and the fee-to-volume ratio — the number
 * that makes "gas" comparable across businesses of different sizes. The
 * per-day chart shows fee fluctuations (congestion pushes the base fee),
 * and the export gives the raw log to a spreadsheet.
 *
 * The per-transaction fee is currently the Stellar base fee (100 stroops per
 * operation); each settled payment maps to one fee entry. When the indexer
 * captures `fee_charged` from transaction receipts, the same parser picks
 * it up without this page changing.
 */

type LoadState =
  | { status: 'loading'; loaded: number }
  | { status: 'ready'; entries: GasFeeLogEntry[]; truncated: boolean }
  | { status: 'error'; message: string };

export default function GasAnalyticsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading', loaded: 0 });
  const online = useOnline();

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    (async () => {
      // Reset to a loading state on (re)connect — the effect also re-runs
      // after the browser comes back online, where the previous view may be
      // an error.
      setState({ status: 'loading', loaded: 0 });
      try {
        const { payments, truncated } = await fetchAllPayments({
          signal: controller.signal,
          onProgress: (loaded) => {
            if (!controller.signal.aborted) setState({ status: 'loading', loaded });
          },
        });
        if (controller.signal.aborted) return;
        // One fee entry per settled payment, at the Stellar base fee.
        const entries: GasFeeLogEntry[] = [];
        for (const payment of payments) {
          try {
            entries.push(
              parseGasFeeLogEntry({
                txHash: payment.tx_hash,
                ledger: payment.ledger,
                fee: STELLAR_BASE_FEE_STROOPS,
                timestamp: payment.ts,
                amount: payment.amount,
              }),
            );
          } catch {
            // A malformed payment row is skipped rather than allowed to
            // deflate the totals with a zero-fee entry.
          }
        }
        setState({ status: 'ready', entries, truncated });
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setState({ status: 'error', message: describeFailure(error, navigator.onLine) });
        }
      }
    })();
    return () => controller.abort();
  }, [online]);

  const aggregate = useMemo(
    () => (state.status === 'ready' ? aggregateGasFees(state.entries) : null),
    [state],
  );

  const exportCsv = () => {
    if (state.status !== 'ready') return;
    const blob = new Blob([gasCsvExport(state.entries)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = gasCsvFilename();
    link.click();
    // Safari needs the click dispatched before the object URL goes away.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  };

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
                Gas &amp; Network Fees
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {state.status === 'ready' && (
                <button
                  type="button"
                  onClick={exportCsv}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Export CSV
                </button>
              )}
              <Link
                href="/dashboard"
                className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                ← Settlements
              </Link>
            </div>
          </div>

          <p className="text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
            Every settlement pays the Stellar network a fee. These figures total what your business
            has paid in network fees, what a card processor would have charged on the same volume,
            and how the two compare.
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
            {state.entries.length.toLocaleString()} payments, not older ones.
          </p>
        )}

        {aggregate && (
          <>
            <section className="grid sm:grid-cols-3 gap-6">
              <Stat
                label="Total gas spent"
                value={`${stroopsToXlm(aggregate.totalStroops)} XLM`}
                note={`${aggregate.totalStroops.toString()} stroops across ${aggregate.transactions} transactions`}
              />
              <Stat
                label="Average fee per transaction"
                value={
                  aggregate.averageStroopsPerTx === null
                    ? '—'
                    : `${aggregate.averageStroopsPerTx.toString()} stroops`
                }
                note="Base fee per operation, per settlement"
              />
              <Stat
                label="Fee to volume ratio"
                value={formatFeeToVolumeRatio(aggregate.feeToVolumeRatio)}
                note="Network fees as a share of settled volume"
              />
            </section>

            <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white mb-6">
                Fees over time
              </h2>
              <GasExpenditureChart
                buckets={aggregate.buckets}
                rangeLabel={`${aggregate.buckets.length} day${aggregate.buckets.length === 1 ? '' : 's'}`}
              />
            </section>

            <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 transition-colors duration-300">
              <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white mb-6">
                Versus traditional payment rails
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Network fees compared with card processing on the same volume
                  </caption>
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 text-left">
                      <th scope="col" className="pb-3 pr-4">
                        Rail
                      </th>
                      <th scope="col" className="pb-3 pr-4 text-right">
                        Fee on your volume
                      </th>
                      <th scope="col" className="pb-3 pr-4 text-right">
                        Difference
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100 dark:border-white/5">
                      <td className="py-3 pr-4 text-slate-900 dark:text-white font-medium">
                        Stellar network
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {stroopsToXlm(aggregate.totalStroops)} XLM
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-400 dark:text-slate-500">—</td>
                    </tr>
                    <tr className="border-t border-slate-100 dark:border-white/5">
                      <td className="py-3 pr-4 text-slate-900 dark:text-white font-medium">
                        Card processing (2.9% + 30¢)
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {stroopsToXlm(traditionalCardFeeForVolume(aggregate.volumeStroops))} XLM
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-700 dark:text-emerald-400 font-bold">
                        {stroopsToXlm(
                          traditionalCardFeeForVolume(aggregate.volumeStroops) -
                            aggregate.totalStroops,
                        )}{' '}
                        XLM more
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </PageContainer>
    </main>
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
