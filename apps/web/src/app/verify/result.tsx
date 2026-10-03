'use client';

import React from 'react';
import type { VerifyResponse } from '../api/verify/route';
import { CopyButton } from '@/components/copy-button';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';

export function Result({
  result,
  resultRef,
}: {
  result: VerifyResponse;
  resultRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { local, onchain, verified, batch } = result;

  return (
    <div className="space-y-6 mt-12 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Verification verdict"
        aria-live="polite"
        className={`outline-none focus:ring-2 focus:ring-emerald-500 border p-6 md:p-12 transition-colors duration-300 ${verified ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-[#0a111a] shadow-lg shadow-emerald-600/10 dark:shadow-[0_0_50px_rgba(16,185,129,0.1)]' : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-[#0a111a] shadow-lg shadow-red-600/10 dark:shadow-[0_0_50px_rgba(239,68,68,0.1)]'}`}
      >
        <div className="flex items-center gap-4 mb-4">
          <div
            aria-hidden="true"
            className={`w-12 h-12 flex items-center justify-center text-xl font-bold transition-colors duration-300 ${verified ? 'bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black' : 'bg-red-600 dark:bg-red-500 text-white dark:text-black'}`}
          >
            {verified ? '✓' : '✕'}
          </div>
          <div>
            <h2
              className={`text-3xl font-black tracking-tight transition-colors duration-300 ${verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            >
              <span className="sr-only">Verdict: </span>
              {verified ? 'Proof Verified' : 'Proof Rejected'}
            </h2>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-lg transition-colors duration-300">
          {verified
            ? 'The receipt cryptographic proof accurately resolves to the anchored Merkle root on Stellar.'
            : 'This receipt is invalid. The cryptographic proof does not lead to the anchored batch root.'}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <CheckCard title="Local Compute" source="Recomputed in browser" result={local} />
        <CheckCard title="Ledger Contract" source="Queried from Stellar node" result={onchain} />
      </div>

      {batch && (
        <div className="border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a111a] p-6 md:p-8 space-y-6 shadow-md dark:shadow-none transition-colors duration-300">
          <p className="uppercase tracking-widest font-bold text-xs text-slate-400 dark:text-slate-500 mb-2 transition-colors duration-300">
            Anchored Batch Metadata
          </p>
          <div className="grid sm:grid-cols-2 gap-8">
            <Detail label="Batch ID" value={`#${batch.id}`} />
            <Detail label="Transaction Count" value={batch.count.toString()} />
            <Detail label="Period Start">
              <time
                dateTime={toISO8601(batch.periodStart * 1000)}
                title={toISO8601(batch.periodStart * 1000)}
                className="text-slate-900 dark:text-white font-medium text-lg"
              >
                {formatTimestamp(batch.periodStart * 1000)}
              </time>
            </Detail>
            <Detail label="Period End">
              <time
                dateTime={toISO8601(batch.periodEnd * 1000)}
                title={toISO8601(batch.periodEnd * 1000)}
                className="text-slate-900 dark:text-white font-medium text-lg"
              >
                {formatTimestamp(batch.periodEnd * 1000)}
              </time>
            </Detail>
            <div className="sm:col-span-2">
              <Detail label="Merkle Root" value={batch.root} mono copyable />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCard({
  title,
  source,
  result,
}: {
  title: string;
  source: string;
  result: { ok: boolean | null; error?: string };
}) {
  return (
    <div className="border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#0a111a] p-6 shadow-sm dark:shadow-none transition-colors duration-300">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors duration-300">
            {title}
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 transition-colors duration-300">
            {source}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border transition-colors duration-300 ${result.ok ? 'bg-emerald-50 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' : 'bg-red-50 dark:bg-red-500/5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'}`}
        >
          {result.ok ? (
            <span aria-hidden="true" className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
          ) : (
            <span aria-hidden="true" className="w-1.5 h-1.5 bg-red-500 dark:bg-red-400" />
          )}
          <span>{result.ok ? 'Valid' : 'Failed'}</span>
        </div>
      </div>
      {result.error && (
        <p className="text-xs text-red-600 dark:text-red-400/80 font-mono mt-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-transparent p-3 dark:p-2 dark: transition-colors duration-300">
          {result.error}
        </p>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  copyable,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  copyable?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 transition-colors duration-300">
          {label}
        </p>
        {copyable && value && <CopyButton value={value} label={label} />}
      </div>
      <p
        className={`transition-colors duration-300 ${mono ? 'text-slate-900 dark:text-white font-mono text-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-transparent px-3 py-2 break-all' : 'text-slate-900 dark:text-white font-medium text-lg'}`}
      >
        {children ?? value}
      </p>
    </div>
  );
}
