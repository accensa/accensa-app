'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * How the current tip amount was chosen. `'custom'` takes priority over
 * `'percent'` whenever both a percent and a custom amount are somehow set,
 * since the custom input is the more specific choice.
 */
export type TipSelection = 'none' | 'percent' | 'custom';

export interface CheckoutContextValue {
  /** Cart/transaction amount before any tip, in the checkout's display currency. */
  subtotal: number;
  /** Whether the merchant allows tip prompts at all (admin preference). */
  tipEnabled: boolean;
  /** Which kind of tip is currently active. */
  tipSelection: TipSelection;
  tipPercent: number | null;
  customTipAmount: number | null;
  /** Resolved tip amount, always >= 0. */
  tipAmount: number;
  /** subtotal + tipAmount, rounded to 2 decimals — the amount to authorize. */
  total: number;
  setTipPercent: (percent: number | null) => void;
  setCustomTipAmount: (amount: number | null) => void;
  clearTip: () => void;
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

export interface CheckoutProviderProps {
  subtotal: number;
  /** Merchant admin preference; tipping UI stays hidden entirely when false. */
  tipEnabled?: boolean;
  children: React.ReactNode;
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function CheckoutProvider({ subtotal, tipEnabled = true, children }: CheckoutProviderProps) {
  const [tipPercent, setTipPercentState] = useState<number | null>(null);
  const [customTipAmount, setCustomTipAmountState] = useState<number | null>(null);

  const setTipPercent = (percent: number | null) => {
    setTipPercentState(percent);
    if (percent !== null) setCustomTipAmountState(null);
  };

  const setCustomTipAmount = (amount: number | null) => {
    setCustomTipAmountState(amount === null ? null : Math.max(0, amount));
    if (amount !== null) setTipPercentState(null);
  };

  const clearTip = () => {
    setTipPercentState(null);
    setCustomTipAmountState(null);
  };

  const value = useMemo<CheckoutContextValue>(() => {
    const tipAmount = !tipEnabled
      ? 0
      : customTipAmount !== null
        ? round2(customTipAmount)
        : tipPercent !== null
          ? round2((subtotal * tipPercent) / 100)
          : 0;

    const tipSelection: TipSelection =
      tipEnabled && customTipAmount !== null
        ? 'custom'
        : tipEnabled && tipPercent !== null
          ? 'percent'
          : 'none';

    return {
      subtotal,
      tipEnabled,
      tipSelection,
      tipPercent: tipEnabled ? tipPercent : null,
      customTipAmount: tipEnabled ? customTipAmount : null,
      tipAmount,
      total: round2(subtotal + tipAmount),
      setTipPercent,
      setCustomTipAmount,
      clearTip,
    };
  }, [subtotal, tipEnabled, tipPercent, customTipAmount]);

  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}

export function useCheckout(): CheckoutContextValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx) throw new Error('useCheckout must be used within a CheckoutProvider');
  return ctx;
}
