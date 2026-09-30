'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetchSystemHealth, overallHealth, type ServiceHealth } from '@/lib/status/healthChecker';

const POLL_INTERVAL_MS = 60_000;

const LABELS: Record<ServiceHealth, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  unknown: 'Not configured',
};

const COLORS: Record<ServiceHealth, string> = {
  operational: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  unavailable: 'bg-red-500',
  unknown: 'bg-slate-400',
};

export function SystemStatusWidget() {
  const [open, setOpen] = useState(false);
  const { data, error } = useSWR('/api/status', fetchSystemHealth, {
    refreshInterval: POLL_INTERVAL_MS,
    revalidateOnFocus: true,
  });
  const overall = data ? overallHealth(data.services) : error ? 'unavailable' : 'unknown';
  const overallLabel =
    overall === 'operational'
      ? 'All Systems Operational'
      : overall === 'degraded'
        ? 'Degraded Performance'
        : overall === 'unavailable'
          ? 'Service Status Unavailable'
          : 'Checking System Status';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${COLORS[overall]}`} />
        {overallLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/40" onClick={() => setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-status-title"
            className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-[#0c131d]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-white/10">
              <h2
                id="system-status-title"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                System status
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close system status"
                className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="mt-5 space-y-4">
              {(
                [
                  ['Horizon RPC / Soroban', data?.services.rpc],
                  ['Indexer database', data?.services.indexer],
                  ['Facilitator / relayer', data?.services.relayer],
                ] as const
              ).map(([label, status]) => {
                const value = status ?? (error ? 'unavailable' : 'unknown');
                return (
                  <div
                    key={label}
                    className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5"
                  >
                    <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <span aria-hidden="true" className={`size-2 rounded-full ${COLORS[value]}`} />
                      {LABELS[value]}
                    </span>
                  </div>
                );
              })}
            </div>
            {data?.checkedAt && (
              <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
                Checked {new Date(data.checkedAt).toLocaleTimeString()}
              </p>
            )}
            {error && (
              <p role="status" className="mt-4 text-sm text-amber-800 dark:text-amber-300">
                Live status could not be refreshed. Showing the last available result.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
