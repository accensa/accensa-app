'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  calculateSplitPayment,
  suggestOptimalSplit,
  type SplitCalculationResult,
  type SplitRates,
  type SplitCustomerBalances,
} from '@accensa/sdk';
import { ShieldCheck, AlertCircle, RefreshCw, SlidersHorizontal, ArrowRight } from 'lucide-react';

export interface SplitPaymentSelectorProps {
  /** Required checkout total in USD */
  totalAmountUsd: number;
  /** Available customer wallet balances */
  customerBalances: {
    usdc: string | number;
    xlm: string | number;
  };
  /** Real-time market exchange rates */
  exchangeRates?: {
    xlmUsdRate: number;
    usdcUsdRate?: number;
  };
  /** Slippage tolerance percentage (e.g. 1.0 for 1%). Default: 1.0 */
  slippageTolerancePercent?: number;
  /** Initial USDC percentage allocation (0 to 100). Defaults to 50 or optimal */
  initialUsdcPercentage?: number;
  /** Callback fired when split allocation changes */
  onSplitChange?: (split: SplitCalculationResult) => void;
  /** Callback fired when customer confirms the split payment */
  onConfirmPayment?: (split: SplitCalculationResult) => void | Promise<void>;
  /** Whether controls are disabled */
  disabled?: boolean;
}

const DEFAULT_RATES: SplitRates = {
  xlmUsdRate: 0.12,
  usdcUsdRate: 1.0,
};

export function SplitPaymentSelector({
  totalAmountUsd,
  customerBalances,
  exchangeRates = DEFAULT_RATES,
  slippageTolerancePercent = 1.0,
  initialUsdcPercentage = 50,
  onSplitChange,
  onConfirmPayment,
  disabled = false,
}: SplitPaymentSelectorProps) {
  const [usdcPercentage, setUsdcPercentage] = useState<number>(initialUsdcPercentage);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Compute split allocations
  const splitResult: SplitCalculationResult = useMemo(() => {
    const balances: SplitCustomerBalances = {
      usdc: customerBalances.usdc,
      xlm: customerBalances.xlm,
    };

    return calculateSplitPayment({
      totalCheckoutUsd: totalAmountUsd,
      usdcPercentage,
      rates: exchangeRates,
      customerBalances: balances,
      slippageTolerancePercent,
    });
  }, [totalAmountUsd, usdcPercentage, exchangeRates, customerBalances, slippageTolerancePercent]);

  // Handle slider adjustment
  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setUsdcPercentage(val);
      setErrorMessage(null);
      if (onSplitChange) {
        const updated = calculateSplitPayment({
          totalCheckoutUsd: totalAmountUsd,
          usdcPercentage: val,
          rates: exchangeRates,
          customerBalances,
          slippageTolerancePercent,
        });
        onSplitChange(updated);
      }
    },
    [totalAmountUsd, exchangeRates, customerBalances, slippageTolerancePercent, onSplitChange],
  );

  // Quick preset buttons
  const applyPreset = useCallback(
    (pct: number) => {
      setUsdcPercentage(pct);
      setErrorMessage(null);
      if (onSplitChange) {
        const updated = calculateSplitPayment({
          totalCheckoutUsd: totalAmountUsd,
          usdcPercentage: pct,
          rates: exchangeRates,
          customerBalances,
          slippageTolerancePercent,
        });
        onSplitChange(updated);
      }
    },
    [totalAmountUsd, exchangeRates, customerBalances, slippageTolerancePercent, onSplitChange],
  );

  const applyOptimal = useCallback(() => {
    const optimalPct = suggestOptimalSplit(totalAmountUsd, Number(customerBalances.usdc || 0));
    applyPreset(optimalPct);
  }, [totalAmountUsd, customerBalances.usdc, applyPreset]);

  // Handle payment confirmation
  const handleConfirm = async () => {
    if (!splitResult.canAfford) {
      setErrorMessage(
        `Insufficient funds in wallet for ${splitResult.insufficientTokens.join(' & ')}.`,
      );
      return;
    }

    if (onConfirmPayment) {
      try {
        setIsSubmitting(true);
        setErrorMessage(null);
        await onConfirmPayment(splitResult);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Split payment failed to submit';
        setErrorMessage(msg);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const xlmPercentage = 100 - usdcPercentage;
  const isUsdcInsufficient = splitResult.insufficientTokens.includes('USDC');
  const isXlmInsufficient = splitResult.insufficientTokens.includes('XLM');

  return (
    <div
      data-testid="split-payment-selector"
      className="w-full bg-white/50 dark:bg-white/5 backdrop-blur-2xl border border-slate-200 dark:border-white/10 p-6 md:p-8 space-y-6 text-slate-800 dark:text-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-colors duration-300"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              <SlidersHorizontal className="w-4 h-4" />
            </span>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Split Tender Payment
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Allocate your checkout total across USDC and XLM wallet balances
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Total Due</p>
          <p className="text-2xl font-black text-slate-900 dark:text-white">
            {`$${totalAmountUsd.toFixed(2)}`}{' '}
            <span className="text-xs font-normal text-slate-500">USD</span>
          </p>
        </div>
      </div>

      {/* Live Exchange Rate & Slippage Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-100/70 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs">
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
          <span>Exchange Rate:</span>
          <span className="font-mono font-bold text-slate-900 dark:text-white">
            {`1 XLM = $${exchangeRates.xlmUsdRate.toFixed(4)} USD`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Slippage Protection:</span>
          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
            {`±${slippageTolerancePercent}%`}
          </span>
        </div>
      </div>

      {/* Balance Allocation Slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider">
          <span className="text-emerald-600 dark:text-emerald-400">{`USDC: ${usdcPercentage}%`}</span>
          <span className="text-amber-600 dark:text-amber-400">{`XLM: ${xlmPercentage}%`}</span>
        </div>

        <div className="relative">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={usdcPercentage}
            onChange={handleSliderChange}
            disabled={disabled || isSubmitting}
            aria-label="Split allocation slider between USDC and XLM"
            role="slider"
            aria-valuenow={usdcPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            className="w-full h-3 appearance-none cursor-pointer bg-slate-200 dark:bg-white/10 accent-emerald-600 dark:accent-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {/* Visual split progress bar */}
          <div className="h-1.5 w-full flex overflow-hidden mt-1.5">
            <div
              style={{ width: `${usdcPercentage}%` }}
              className="bg-emerald-500 transition-all duration-150"
            />
            <div
              style={{ width: `${xlmPercentage}%` }}
              className="bg-amber-500 transition-all duration-150"
            />
          </div>
        </div>

        {/* Quick Split Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mr-1">
            Presets:
          </span>
          {[
            { label: '100% USDC', pct: 100 },
            { label: '75 / 25', pct: 75 },
            { label: '50 / 50', pct: 50 },
            { label: '25 / 75', pct: 25 },
            { label: '100% XLM', pct: 0 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset.pct)}
              disabled={disabled || isSubmitting}
              className={`px-2.5 py-1 text-xs font-semibold border transition-all cursor-pointer ${
                usdcPercentage === preset.pct
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-black border-slate-900 dark:border-white'
                  : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={applyOptimal}
            disabled={disabled || isSubmitting}
            title="Automatically maximize USDC based on your available wallet balance"
            className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer"
          >
            Optimal Split
          </button>
        </div>
      </div>

      {/* Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        {/* USDC Allocation Card */}
        <div
          data-testid="usdc-allocation-card"
          className={`p-4 border transition-colors ${
            isUsdcInsufficient
              ? 'border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
              : 'border-slate-200 dark:border-white/10 bg-white/30 dark:bg-white/5'
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-white/5">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              USDC Portion
            </span>
            <span className="text-xs font-mono font-semibold text-slate-500">
              {`${usdcPercentage}%`}
            </span>
          </div>

          <div className="pt-3 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">Payment:</span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                {`${splitResult.usdcAllocation.amount} USDC`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>USD Value:</span>
              <span>{`$${splitResult.usdcAllocation.fiatValueUsd.toFixed(2)}`}</span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/40 dark:border-white/5">
              <span className="text-slate-400">Wallet Balance:</span>
              <span
                className={`font-mono ${isUsdcInsufficient ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}
              >
                {`${customerBalances.usdc} USDC`}
              </span>
            </div>
            {isUsdcInsufficient && (
              <p className="text-[11px] text-red-600 dark:text-red-400 pt-1 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Insufficient USDC balance
              </p>
            )}
          </div>
        </div>

        {/* XLM Allocation Card */}
        <div
          data-testid="xlm-allocation-card"
          className={`p-4 border transition-colors ${
            isXlmInsufficient
              ? 'border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
              : 'border-slate-200 dark:border-white/10 bg-white/30 dark:bg-white/5'
          }`}
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-white/5">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              XLM Portion
            </span>
            <span className="text-xs font-mono font-semibold text-slate-500">
              {`${xlmPercentage}%`}
            </span>
          </div>

          <div className="pt-3 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">Payment:</span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-white">
                {`${splitResult.xlmAllocation.amount} XLM`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>USD Value:</span>
              <span>{`$${splitResult.xlmAllocation.fiatValueUsd.toFixed(2)}`}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>Max with Slippage:</span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {`${splitResult.maxXlmDeductionWithSlippage} XLM`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/40 dark:border-white/5">
              <span className="text-slate-400">Wallet Balance:</span>
              <span
                className={`font-mono ${isXlmInsufficient ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-600 dark:text-slate-300'}`}
              >
                {`${customerBalances.xlm} XLM`}
              </span>
            </div>
            {isXlmInsufficient && (
              <p className="text-[11px] text-red-600 dark:text-red-400 pt-1 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Insufficient XLM balance for maximum slippage
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Combined Coverage Summary & Error message */}
      <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Combined Coverage:</span>
          <span className="font-bold text-slate-900 dark:text-white font-mono">
            {`$${splitResult.coveredUsd.toFixed(2)} / $${totalAmountUsd.toFixed(2)} USD (${splitResult.isFullyCovered ? '100% Covered' : 'Incomplete'})`}
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="p-3 border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-[#1a0a0a] text-red-700 dark:text-red-400 text-xs flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Button */}
        <button
          type="button"
          onClick={handleConfirm}
          disabled={disabled || !splitResult.canAfford || isSubmitting}
          aria-busy={isSubmitting}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black font-black text-sm uppercase tracking-wider hover:bg-emerald-500 dark:hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
        >
          {isSubmitting ? (
            <span>Processing Atomic Payment...</span>
          ) : (
            <>
              <span>
                Pay {splitResult.usdcAllocation.amount} USDC + {splitResult.xlmAllocation.amount}{' '}
                XLM
              </span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
