'use client';

import React, { useEffect, useState } from 'react';
import { formatSavings, savingsMilestone } from '@/lib/analytics/savingsCalculator';
import { fromStroops, toStroops } from '@/lib/money';

/**
 * Fee savings banner (#419).
 *
 * The merchant dashboard's answer to "what does Accensa cost me versus a
 * card processor?": an animated cumulative counter over the current month's
 * net savings (theoretical 2.9% + 30¢ fees minus actual protocol + network
 * fees), a milestone badge at $100/$500/$1,000/$5,000/$10,000, and a share
 * button that copies a social-media-ready summary.
 *
 * The counter animates from 0 to the target on mount so a new settlement
 * reads as money arriving. The initial render already shows the final value
 * (effects do not run during SSR or `renderToString` tests); the animation
 * is layered on top in an effect, so the displayed number is never wrong,
 * only briefly static before it counts up.
 */

export interface SavingsBannerProps {
  /** Net savings for the current month, as a decimal string. */
  monthSavings: string;
  /** All-time net savings, as a decimal string. */
  totalSavings: string;
  /** Settled transactions counted this month. */
  monthTransactions: number;
  /** Asset the amounts are denominated in, e.g. "XLM". */
  asset: string;
  /** Human-readable month label, e.g. "September 2026". */
  monthLabel: string;
}

const ANIMATION_MS = 1_200;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animates a decimal-string amount from 0 to `target`.
 *
 * The animation is pure presentation: it interpolates the stroop integer and
 * formats only at the end of each frame, so no intermediate float is ever
 * treated as money. Returns the formatted display string for the current
 * value, which is the target until the effect first runs.
 */
function useAnimatedAmount(target: string): string {
  // The initial render already shows the formatted target: effects do not
  // run during SSR or renderToString tests, so the displayed number is the
  // real figure (not $0.00) before the count-up animation layers on top.
  const [display, setDisplay] = useState(() => formatSavings(target));

  useEffect(() => {
    const targetStroops = toStroops(target) ?? 0n;
    if (targetStroops <= 0n) {
      // The initial state already rendered formatSavings(target) — $0.00 —
      // so there is nothing to animate and nothing to update.
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (ms: number) => {
      if (start === null) start = ms;
      const t = Math.min(1, (ms - start) / ANIMATION_MS);
      const eased = Math.round(Number(targetStroops) * easeOutCubic(t));
      setDisplay(formatSavings(fromStroops(BigInt(eased))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return display;
}

export function SavingsBanner({
  monthSavings,
  totalSavings,
  monthTransactions,
  asset,
  monthLabel,
}: SavingsBannerProps) {
  const animatedSavings = useAnimatedAmount(monthSavings);
  const milestone = savingsMilestone(monthSavings);
  const [shared, setShared] = useState(false);

  const share = async () => {
    const text = `I've saved ${formatSavings(monthSavings)} in payment processing fees this month with Accensa — no 2.9% + 30¢ card fees, just Stellar network costs.`;
    try {
      await navigator.clipboard.writeText(text);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // Clipboard unavailable (permissions, non-secure context); the text is
      // also visible on the badge for manual copying.
    }
  };

  return (
    <section
      aria-label="Fee savings versus traditional credit card processing"
      className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-8 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden transition-colors duration-300"
    >
      <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 blur-[40px] dark:blur-[50px] pointer-events-none" />
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
            Saved vs. card processing (2.9% + 30¢)
          </p>
          <p className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 dark:text-white tabular-nums transition-colors duration-300">
            You have saved {animatedSavings}{' '}
            <span className="text-2xl text-emerald-700 dark:text-emerald-400 font-bold">
              {asset}
            </span>
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            this month across {monthTransactions} settled transaction
            {monthTransactions === 1 ? '' : 's'} · {formatSavings(totalSavings)} all time ·{' '}
            {monthLabel}
          </p>
          {milestone !== null && (
            <p className="inline-flex items-center gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-emerald-400 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300">
              Milestone reached: {formatSavings(milestone.toFixed(2))} saved
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={share}
          className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
        >
          <span aria-live="polite">{shared ? 'Copied to clipboard' : 'Share'}</span>
        </button>
      </div>
    </section>
  );
}
