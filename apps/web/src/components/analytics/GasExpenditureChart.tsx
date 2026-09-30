'use client';

import React, { useState } from 'react';
import type { GasDayBucket } from '@/lib/analytics/gasCalculator';
import { stroopsToXlm } from '@/lib/analytics/gasCalculator';

/**
 * Network fee expenditure over time (#435).
 *
 * Inline SVG bars, one per day, matching the revenue chart's geometry. The
 * unit toggle switches every label and the y-axis between stroops (the
 * ledger's integer unit) and XLM (what a merchant thinks in) — the
 * underlying series is stroops either way; the toggle only formats.
 */

export interface GasExpenditureChartProps {
  buckets: GasDayBucket[];
  /** Month the series covers, for the accessible label. */
  rangeLabel: string;
}

type FeeUnit = 'stroops' | 'xlm';

const VIEW_W = 1000;
const VIEW_H = 260;
const PAD_BOTTOM = 28;
const PAD_TOP = 8;
const PLOT_H = VIEW_H - PAD_BOTTOM - PAD_TOP;

export function GasExpenditureChart({ buckets, rangeLabel }: GasExpenditureChartProps) {
  const [unit, setUnit] = useState<FeeUnit>('stroops');

  if (buckets.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">
        No network fees recorded yet.
      </p>
    );
  }

  const slot = VIEW_W / buckets.length;
  const barW = Math.max(1, Math.min(slot * 0.62, 56));
  const labelEvery = Math.ceil(buckets.length / 12);

  const formatFee = (stroops: bigint): string =>
    unit === 'stroops' ? stroops.toString() : stroopsToXlm(stroops);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        Network fees per day in {rangeLabel}, in {unit === 'stroops' ? 'stroops' : 'XLM'}.
      </figcaption>

      <div className="flex justify-end mb-4">
        <div
          className="inline-flex border border-slate-200 dark:border-white/10"
          role="group"
          aria-label="Fee unit"
        >
          {(['stroops', 'xlm'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setUnit(option)}
              aria-pressed={unit === option}
              className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${
                unit === option
                  ? 'bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
              }`}
            >
              {option === 'stroops' ? 'stroops' : 'XLM'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full min-w-[520px] h-[260px]"
          role="img"
          aria-label={`Network fees per day. Total ${formatFee(
            buckets.reduce((sum, b) => sum + b.totalStroops, 0n),
          )} ${unit === 'stroops' ? 'stroops' : 'XLM'} across ${buckets.length} days.`}
        >
          <line
            x1={0}
            y1={PAD_TOP + PLOT_H}
            x2={VIEW_W}
            y2={PAD_TOP + PLOT_H}
            className="stroke-slate-200 dark:stroke-white/10"
            strokeWidth={1}
          />

          {buckets.map((bucket, i) => {
            const h = bucket.fraction * PLOT_H;
            const x = i * slot + (slot - barW) / 2;
            const top = PAD_TOP + PLOT_H - h;
            return (
              <g key={bucket.day}>
                <title>{`${bucket.label}: ${formatFee(bucket.totalStroops)} ${unit} across ${bucket.transactions} transaction${bucket.transactions === 1 ? '' : 's'}`}</title>
                {h > 0 && (
                  <rect
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    className="fill-emerald-500/80 dark:fill-emerald-400/70"
                  />
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={i * slot + slot / 2}
                    y={VIEW_H - 8}
                    textAnchor="middle"
                    className="fill-slate-400 dark:fill-slate-500 text-[11px]"
                  >
                    {bucket.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
