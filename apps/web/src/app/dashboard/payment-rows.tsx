'use client';

import React from 'react';
import { formatAmount, assetLabel } from '@/lib/money';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';
import { RiskScoreBadge } from '@/components/transactions/RiskScoreBadge';
import type { Payment } from './payments-merge';

export function truncate(value: string, head = 8, tail = 6) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Shared handler for Enter/Space activation on a payment row or card. */
export function handleActivationKeyDown(e: React.KeyboardEvent, onSelect: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect();
  }
}

/** Accessible label identifying a payment by its truncated tx hash and amount. */
export function paymentLabel(p: Payment) {
  return `Payment ${formatAmount(p.amount)} ${assetLabel(p.asset)} (${truncate(p.tx_hash)}), view details`;
}

export function PaymentsCardList({
  payments,
  onSelect,
  manualReviewAbove = 75,
}: {
  payments: Payment[];
  onSelect: (payment: Payment) => void;
  manualReviewAbove?: number;
}) {
  return (
    <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
      {payments.map((payment) => (
        <div
          key={payment.tx_hash}
          role="button"
          tabIndex={0}
          aria-label={paymentLabel(payment)}
          onClick={() => onSelect(payment)}
          onKeyDown={(e) => handleActivationKeyDown(e, () => onSelect(payment))}
          className="p-6 hover:bg-slate-50 dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 transition-colors cursor-pointer group flex flex-col gap-4"
        >
          <div className="flex justify-between items-start">
            <div>
              <span className="font-black text-2xl tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                {formatAmount(payment.amount)}
              </span>
              <span className="text-slate-400 dark:text-slate-500 ml-2 text-xs font-bold">
                {assetLabel(payment.asset)}
              </span>
            </div>
            <div className="text-slate-500 text-xs text-right mt-1">
              <time dateTime={toISO8601(payment.ts)} title={toISO8601(payment.ts)}>
                {formatTimestamp(payment.ts)}
              </time>
            </div>
          </div>
          {typeof payment.risk_score === 'number' && (
            <RiskScoreBadge
              score={payment.risk_score}
              countryCode={payment.risk_country_code}
              requiresManualReview={payment.risk_score > manualReviewAbove}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Transaction
              </p>
              <p className="font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                {truncate(payment.tx_hash)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Payer
              </p>
              <p className="font-mono text-slate-500 dark:text-slate-400 text-sm">
                {truncate(payment.payer, 4, 4)}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Route
              </p>
              {payment.route ? (
                <div className="inline-flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 px-2.5 py-1 text-sm transition-colors duration-300">
                  {payment.method && (
                    <span className="text-emerald-600 dark:text-emerald-500/70 font-mono font-bold text-xs">
                      {payment.method}
                    </span>
                  )}
                  <span className="font-mono text-slate-600 dark:text-slate-300">
                    {payment.route}
                  </span>
                </div>
              ) : (
                <span className="text-slate-400 dark:text-slate-600">-</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PaymentsTable({
  payments,
  refunded,
  onSelect,
  manualReviewAbove = 75,
}: {
  payments: Payment[];
  refunded: ReadonlySet<string>;
  onSelect: (payment: Payment) => void;
  manualReviewAbove?: number;
}) {
  return (
    <table className="w-full text-left border-collapse whitespace-nowrap">
      <caption className="sr-only">Recent Settlements</caption>
      <thead>
        <tr className="text-slate-600 dark:text-slate-300 text-xs font-bold uppercase tracking-widest border-b border-slate-100 dark:border-white/5 bg-white/40 dark:bg-[#04090f]/50 transition-colors duration-300">
          <th scope="col" className="px-8 py-5">
            Transaction
          </th>
          <th scope="col" className="px-8 py-5">
            Amount
          </th>
          <th scope="col" className="px-8 py-5">
            Payer
          </th>
          <th scope="col" className="px-8 py-5">
            Route
          </th>
          <th scope="col" className="px-8 py-5">
            Time
          </th>
          <th scope="col" className="px-8 py-5">
            Risk
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
        {payments.map((payment) => (
          <tr
            key={payment.tx_hash}
            onClick={() => onSelect(payment)}
            className="hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer group"
          >
            <td className="px-8 py-5 font-mono text-emerald-700 dark:text-emerald-400 text-sm group-hover:text-emerald-800 dark:group-hover:text-emerald-300 transition-colors">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(payment);
                }}
                onKeyDown={(e) => handleActivationKeyDown(e, () => onSelect(payment))}
                aria-label={paymentLabel(payment)}
                className="font-mono text-emerald-700 dark:text-emerald-400 group-hover:text-emerald-800 dark:group-hover:text-emerald-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 transition-colors cursor-pointer text-left bg-transparent p-0 border-0 inline-flex items-center"
              >
                {truncate(payment.tx_hash)}
              </button>
              {refunded.has(payment.tx_hash) && (
                <span
                  className="ml-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-amber-400 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 align-middle"
                  title="Refunded from the vault in this session"
                >
                  Refunded
                </span>
              )}
            </td>
            <td className="px-8 py-5">
              <span className="font-black text-lg tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                {formatAmount(payment.amount)}
              </span>
              <span className="text-slate-600 dark:text-slate-400 ml-2 text-xs font-bold">
                {assetLabel(payment.asset)}
              </span>
            </td>
            <td className="px-8 py-5 font-mono text-slate-600 dark:text-slate-300 text-sm transition-colors duration-300">
              {truncate(payment.payer, 4, 4)}
            </td>
            <td className="px-8 py-5">
              {payment.route ? (
                <div className="inline-flex items-center gap-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1 text-sm transition-colors duration-300">
                  {payment.method && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold text-xs">
                      {payment.method}
                    </span>
                  )}
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {payment.route}
                  </span>
                </div>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">-</span>
              )}
            </td>
            <td className="px-8 py-5 text-slate-600 dark:text-slate-300 text-sm">
              <time dateTime={toISO8601(payment.ts)} title={toISO8601(payment.ts)}>
                {formatTimestamp(payment.ts)}
              </time>
            </td>
            <td className="px-8 py-5">
              {typeof payment.risk_score === 'number' ? (
                <RiskScoreBadge
                  score={payment.risk_score}
                  countryCode={payment.risk_country_code}
                  requiresManualReview={payment.risk_score > manualReviewAbove}
                />
              ) : (
                <span className="text-slate-400 dark:text-slate-500">Not evaluated</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
