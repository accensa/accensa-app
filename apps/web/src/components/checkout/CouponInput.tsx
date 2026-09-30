'use client';

import React, { useState } from 'react';
import {
  normalizeCouponCode,
  priceBreakdown,
  validateCoupon,
  type Coupon,
  type CouponValidationSuccess,
} from '@/lib/discounts/couponService';

/**
 * Coupon code entry for checkout (#432).
 *
 * The buyer types a code and gets an answer immediately: a spinner while the
 * code is looked up and validated, a buyer-facing hint when it is rejected
 * (expired, exhausted, below the minimum spend, or not stackable), and a
 * savings line item in the price breakdown when it applies.
 *
 * Validation is pure (`lib/discounts/couponService`), so the same rules run
 * here for instant feedback and again server-side before the discount is
 * applied to the authorization amount — this component is the client half
 * of that contract, not the only half.
 */

export interface CouponInputProps {
  /** Order total the code would apply to, as a decimal string. */
  orderAmount: string;
  /** Looks up a coupon by typed code. Null when no such code exists. */
  lookupCoupon: (code: string) => Promise<Coupon | null>;
  /** Codes already applied to this order; the new code must not stack unless allowed. */
  appliedCodes?: string[];
  /** Called with the successful validation when a code is applied. */
  onApply?: (result: CouponValidationSuccess) => void;
  /** Called when an applied code is removed. */
  onClear?: () => void;
}

type Status =
  | { phase: 'idle' }
  | { phase: 'validating' }
  | { phase: 'invalid'; message: string }
  | { phase: 'applied'; result: CouponValidationSuccess };

export function CouponInput({
  orderAmount,
  lookupCoupon,
  appliedCodes = [],
  onApply,
  onClear,
}: CouponInputProps) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>({ phase: 'idle' });

  const apply = async () => {
    const normalized = normalizeCouponCode(code);
    if (!normalized) {
      setStatus({ phase: 'idle' });
      return;
    }
    setStatus({ phase: 'validating' });
    try {
      const coupon = await lookupCoupon(normalized);
      const result = validateCoupon(coupon, { orderAmount, appliedCodes });
      if (result.ok) {
        setStatus({ phase: 'applied', result });
        onApply?.(result);
      } else {
        setStatus({ phase: 'invalid', message: result.message });
      }
    } catch {
      setStatus({ phase: 'invalid', message: 'This code could not be validated.' });
    }
  };

  const remove = () => {
    setCode('');
    setStatus({ phase: 'idle' });
    onClear?.();
  };

  const validating = status.phase === 'validating';
  const applied = status.phase === 'applied' ? status.result : null;
  const breakdown = applied ? priceBreakdown(orderAmount, applied) : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label htmlFor="coupon-code" className="sr-only">
          Coupon code
        </label>
        <input
          id="coupon-code"
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            if (status.phase === 'invalid') setStatus({ phase: 'idle' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void apply();
            }
          }}
          placeholder="Coupon code"
          autoComplete="off"
          disabled={validating || applied !== null}
          aria-invalid={status.phase === 'invalid'}
          aria-describedby={status.phase === 'invalid' ? 'coupon-error' : undefined}
          className="flex-1 border border-slate-300 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-white disabled:opacity-50"
        />
        {applied ? (
          <button
            type="button"
            onClick={remove}
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void apply()}
            disabled={validating || !code.trim()}
            aria-busy={validating}
            className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {validating ? 'Checking…' : 'Apply'}
          </button>
        )}
      </div>

      {validating && (
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400 animate-pulse">
          Validating code…
        </p>
      )}

      {status.phase === 'invalid' && (
        <p id="coupon-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
          {status.message}
        </p>
      )}

      {breakdown && applied && (
        <div className="border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-xs space-y-1">
          {breakdown.lines.map((line) => (
            <p key={line.label} className="flex justify-between text-slate-700 dark:text-slate-300">
              <span>{line.label}</span>
              <span
                className={
                  line.amount.startsWith('-')
                    ? 'text-emerald-700 dark:text-emerald-400 font-bold'
                    : ''
                }
              >
                {line.amount}
              </span>
            </p>
          ))}
          <p className="flex justify-between text-slate-900 dark:text-white font-bold pt-1 border-t border-emerald-200 dark:border-emerald-500/20">
            <span>Total</span>
            <span>{breakdown.total}</span>
          </p>
        </div>
      )}
    </div>
  );
}
