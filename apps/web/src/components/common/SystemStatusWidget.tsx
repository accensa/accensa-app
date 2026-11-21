'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetchSystemHealth, overallHealth, type ServiceHealth } from '@/lib/status/healthChecker';
import { focusRestorer, getFocusable, wrapTabTarget } from '@/lib/dialog-focus';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<(() => void) | null>(null);
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

  const openDialog = useCallback(() => {
    // Capture the trigger before the dialog takes focus, so closing it can hand
    // focus back to the control a keyboard user opened it from.
    const active = document.activeElement;
    restoreFocusRef.current = focusRestorer(
      active && active !== document.body ? (active as HTMLElement) : triggerRef.current,
    );
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    restore?.();
  }, []);

  // Escape dismisses the dialog and Tab wraps inside it, per WCAG modal rules.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    (getFocusable(dialog)[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key === 'Tab') {
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeDialog]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${COLORS[overall]}`} />
        {overallLabel}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/40" onClick={closeDialog}>
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="system-status-title"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-xl outline-none dark:border-white/10 dark:bg-[#0c131d]"
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
                onClick={closeDialog}
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
