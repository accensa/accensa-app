'use client';

import { useEffect, useState } from 'react';
import {
  FIAT_CURRENCIES,
  formatFiatAmount,
  type ExchangeRateSnapshot,
  type FiatCurrency,
} from '@/lib/rates/exchangeRateService';

const STORAGE_KEY = 'accensa.exchange-rates.v1';

export function FiatPriceDisplay({ amountUsd }: { amountUsd: number }) {
  const [snapshot, setSnapshot] = useState<ExchangeRateSnapshot | null>(null);
  const [mode, setMode] = useState<'crypto' | 'fiat'>('fiat');
  const [asset, setAsset] = useState<'XLM' | 'USDC'>('XLM');
  const [currency, setCurrency] = useState<FiatCurrency>('USD');

  useEffect(() => {
    let cachedSnapshot: ExchangeRateSnapshot | null = null;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) cachedSnapshot = JSON.parse(cached) as ExchangeRateSnapshot;
    } catch {
      // Ignore unavailable or malformed browser storage.
    }

    fetch('/api/rates', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Rate request failed');
        return response.json() as Promise<ExchangeRateSnapshot>;
      })
      .then((rates) => {
        setSnapshot(rates);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
        } catch {
          // The live response is still usable when storage is unavailable.
        }
      })
      .catch(() => {
        setSnapshot(
          (current) => current ?? (cachedSnapshot ? { ...cachedSnapshot, stale: true } : null),
        );
      });
  }, []);

  const value = snapshot
    ? mode === 'fiat'
      ? formatFiatAmount(amountUsd * snapshot.fiatPerUsd[currency], currency)
      : `${(amountUsd / (asset === 'XLM' ? snapshot.xlmUsd : snapshot.usdcUsd)).toFixed(asset === 'XLM' ? 4 : 2)} ${asset}`
    : 'Rates unavailable';

  return (
    <div
      className="mt-3 border-t border-slate-200 pt-3 text-left dark:border-white/10"
      data-testid="fiat-price-display"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex border border-slate-200 dark:border-white/15"
          aria-label="Price display mode"
        >
          {(['crypto', 'fiat'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`px-2.5 py-1 text-xs font-semibold capitalize ${mode === option ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 dark:text-slate-300'}`}
            >
              {option}
            </button>
          ))}
        </div>
        {mode === 'fiat' ? (
          <label className="text-xs text-slate-500">
            <span className="sr-only">Fiat currency</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as FiatCurrency)}
              className="border border-slate-200 bg-transparent px-2 py-1 text-slate-800 dark:border-white/15 dark:text-slate-200"
            >
              {FIAT_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div
            className="inline-flex border border-slate-200 dark:border-white/15"
            aria-label="Cryptocurrency unit"
          >
            {(['XLM', 'USDC'] as const).map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={asset === code}
                onClick={() => setAsset(code)}
                className={`px-2.5 py-1 text-xs font-semibold ${asset === code ? 'bg-emerald-700 text-white' : 'text-slate-600 dark:text-slate-300'}`}
              >
                {code}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">~{value}</p>
        <p className="text-[11px] text-slate-500">
          Approximate
          {snapshot
            ? ` · ${snapshot.stale ? 'cached' : snapshot.provider} · ${new Date(snapshot.fetchedAt).toLocaleTimeString()}`
            : ''}
        </p>
      </div>
    </div>
  );
}
