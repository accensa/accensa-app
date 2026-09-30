'use client';

import React, { useState } from 'react';
import { useCheckout } from '../../context/CheckoutContext';

const QUICK_PERCENTS = [10, 15, 20];

/**
 * Gratuity prompt for the checkout flow (#426).
 *
 * Renders nothing when the merchant has disabled tip prompts
 * (`CheckoutProvider`'s `tipEnabled={false}`), so embedding it is safe even
 * when the preference is unknown ahead of render.
 */
export default function TipSelector() {
  const {
    tipEnabled,
    tipPercent,
    customTipAmount,
    tipAmount,
    subtotal,
    total,
    setTipPercent,
    setCustomTipAmount,
    clearTip,
  } = useCheckout();
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');

  if (!tipEnabled) return null;

  const isPercentSelected = (percent: number) => tipPercent === percent && customTipAmount === null;
  const isCustomSelected = customTipAmount !== null;
  const isNoneSelected = tipPercent === null && customTipAmount === null;

  const selectPercent = (percent: number) => {
    setCustomOpen(false);
    setTipPercent(percent);
  };

  const openCustom = () => {
    setCustomOpen(true);
    setCustomInput(customTipAmount !== null ? String(customTipAmount) : '');
  };

  const handleCustomChange = (value: string) => {
    setCustomInput(value);
    const parsed = Number.parseFloat(value);
    setCustomTipAmount(Number.isFinite(parsed) && parsed >= 0 ? parsed : null);
  };

  const selectNone = () => {
    setCustomOpen(false);
    setCustomInput('');
    clearTip();
  };

  const optionClass = (selected: boolean) =>
    `flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
      selected
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
    }`;

  return (
    <div className="space-y-3" data-testid="tip-selector">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">Add a tip</h4>
        <span className="text-sm text-gray-500" data-testid="tip-amount">
          {tipAmount > 0 ? `+${tipAmount.toFixed(2)}` : 'No tip'}
        </span>
      </div>

      <div className="flex gap-2">
        {QUICK_PERCENTS.map((percent) => (
          <button
            key={percent}
            type="button"
            aria-pressed={isPercentSelected(percent)}
            onClick={() => selectPercent(percent)}
            className={optionClass(isPercentSelected(percent))}
          >
            {percent}%
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isCustomSelected || customOpen}
          onClick={openCustom}
          className={optionClass(isCustomSelected || customOpen)}
        >
          Custom
        </button>
        <button
          type="button"
          aria-pressed={isNoneSelected && !customOpen}
          onClick={selectNone}
          className={optionClass(isNoneSelected && !customOpen)}
        >
          No tip
        </button>
      </div>

      {customOpen && (
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="Custom tip amount"
          aria-label="Custom tip amount"
          value={customInput}
          onChange={(event) => handleCustomChange(event.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      )}

      <div className="space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span data-testid="checkout-subtotal">{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Tip</span>
          <span data-testid="checkout-tip">{tipAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold text-gray-900">
          <span>Total</span>
          <span data-testid="checkout-total">{total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
