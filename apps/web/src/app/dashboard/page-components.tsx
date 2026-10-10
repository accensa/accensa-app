'use client';

import React, { useEffect, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { formatAmount, assetLabel } from '@/lib/money';
import { CopyButton } from '@/components/copy-button';
import { RiskScoreBadge } from '@/components/transactions/RiskScoreBadge';
import { SocialShareButtons } from '@/components/receipts/SocialShareButtons';
import { RefundPanel } from '@/components/refund-panel';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';
import { focusRestorer, getFocusable, wrapTabTarget } from '@/lib/dialog-focus';
import type { Payment } from './payments-merge';

const PAYMENT_MODAL_HEADING_ID = 'payment-details-heading';

function truncate(value: string, head = 8, tail = 6) {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function paymentLabel(p: Payment) {
  return `Payment ${formatAmount(p.amount)} ${assetLabel(p.asset)} (${truncate(p.tx_hash)}), view details`;
}

function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="block text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors duration-300">
          {label}
        </span>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function PaymentModal({
  selected,
  onClose,
  refunded,
  onRefunded,
  canRefund,
}: {
  selected: Payment;
  onClose: () => void;
  refunded: ReadonlySet<string>;
  onRefunded: (tx_hash: string) => void;
  canRefund?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restoreFocus = focusRestorer(
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
    );

    const dialog = dialogRef.current;
    if (dialog) {
      const focusable = getFocusable(dialog);
      (focusable[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialog) {
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

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#04090f]/50 dark:bg-black/80 backdrop-blur-sm transition-colors duration-300"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PAYMENT_MODAL_HEADING_ID}
        tabIndex={-1}
        className="bg-white/95 dark:bg-[#0c131d]/95 backdrop-blur-2xl border border-slate-200 dark:border-white/10 w-full max-w-lg overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_0_50px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] animate-in zoom-in-95 duration-200 transition-colors duration-300 max-h-[90vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 md:px-8 md:py-6 border-b border-slate-200/60 dark:border-white/20 flex justify-between items-center bg-slate-50 dark:bg-[#0a111a] transition-colors duration-300 shrink-0">
          <div className="flex items-center gap-2">
            <h3
              id={PAYMENT_MODAL_HEADING_ID}
              className="text-lg font-black tracking-tight text-slate-900 dark:text-white transition-colors duration-300"
            >
              Payment Details
            </h3>
            {refunded.has(selected.tx_hash) && (
              <span
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-amber-400 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 align-middle"
                title="Refunded from the vault in this session"
              >
                Refunded
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close payment details"
            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="p-6 md:p-8 space-y-6 md:space-y-8 overflow-y-auto">
          <Field
            label="Transaction Hash"
            action={<CopyButton value={selected.tx_hash} label="Transaction Hash" />}
          >
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-400 dark:border-emerald-500/20 px-4 py-3 font-mono text-xs text-emerald-700 dark:text-emerald-400 break-all transition-colors duration-300">
              {selected.tx_hash}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-8">
            <Field label="Amount">
              <span className="text-3xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
                {formatAmount(selected.amount)}{' '}
                <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 transition-colors duration-300">
                  {assetLabel(selected.asset)}
                </span>
              </span>
            </Field>
            <Field label="Ledger">
              <span className="font-mono text-slate-600 dark:text-slate-300 text-lg transition-colors duration-300">
                {selected.ledger ?? '-'}
              </span>
            </Field>
          </div>
          <Field label="Payer" action={<CopyButton value={selected.payer} label="Payer Address" />}>
            <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300 break-all transition-colors duration-300">
              {selected.payer}
            </div>
          </Field>
          <Field label="Timestamp">
            <time
              dateTime={toISO8601(selected.ts)}
              title={toISO8601(selected.ts)}
              className="text-slate-700 dark:text-slate-300 transition-colors duration-300"
            >
              {formatTimestamp(selected.ts)}
            </time>
          </Field>

          <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${selected.tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20 shadow-sm dark:shadow-none transition-all font-bold text-sm tracking-wide uppercase"
            >
              View on Explorer <ArrowUpRight className="w-4 h-4 opacity-70" />
            </a>
          </div>

          <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
            <SocialShareButtons
              txHash={selected.tx_hash}
              amount={formatAmount(selected.amount)}
              asset={assetLabel(selected.asset)}
            />
          </div>

          {canRefund !== false && (
            <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-3">
                Refund
              </p>
              <RefundPanel payment={selected} onRefunded={onRefunded} />
            </div>
          )}
          <div className="pt-6 mt-6 border-t border-slate-100 dark:border-white/10 transition-colors duration-300">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 mb-3">
              Refund
            </p>
            <RefundPanel payment={selected} onRefunded={onRefunded} />
          </div>
        </div>
      </div>
    </div>
  );
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(payment);
            }
          }}
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
            role="button"
            tabIndex={0}
            aria-label={paymentLabel(payment)}
            onClick={() => onSelect(payment)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(payment);
              }
            }}
            className="hover:bg-slate-50 dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400 transition-colors cursor-pointer group"
          >
            <td className="px-8 py-5 font-mono text-emerald-700 dark:text-emerald-400 text-sm group-hover:text-emerald-800 dark:group-hover:text-emerald-300 transition-colors">
              {truncate(payment.tx_hash)}
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

export function TableSkeleton() {
  return (
    <>
      <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5" aria-hidden="true">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-6 flex flex-col gap-4 animate-pulse">
            <div className="flex justify-between items-start">
              <div className="h-8 w-32 bg-slate-200/80 dark:bg-white/10" />
              <div className="h-4 w-28 bg-slate-200/60 dark:bg-white/5 mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="h-3 w-16 bg-slate-200/60 dark:bg-white/5 mb-2" />
                <div className="h-4 w-24 bg-slate-200/80 dark:bg-white/10" />
              </div>
              <div>
                <div className="h-3 w-12 bg-slate-200/60 dark:bg-white/5 mb-2" />
                <div className="h-4 w-20 bg-slate-200/80 dark:bg-white/10" />
              </div>
              <div className="col-span-2">
                <div className="h-3 w-12 bg-slate-200/60 dark:bg-white/5 mb-2" />
                <div className="h-6 w-36 bg-slate-200/60 dark:bg-white/5" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto" aria-hidden="true">
        <table className="w-full text-left border-collapse whitespace-nowrap">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/5">
            {[...Array(5)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                <td className="px-8 py-5">
                  <div className="h-5 w-32 bg-slate-200/80 dark:bg-white/10" />
                </td>
                <td className="px-8 py-5">
                  <div className="h-6 w-24 bg-slate-200/80 dark:bg-white/10" />
                </td>
                <td className="px-8 py-5">
                  <div className="h-5 w-24 bg-slate-200/80 dark:bg-white/10" />
                </td>
                <td className="px-8 py-5">
                  <div className="h-6 w-32 bg-slate-200/80 dark:bg-white/10" />
                </td>
                <td className="px-8 py-5">
                  <div className="h-5 w-36 bg-slate-200/80 dark:bg-white/10" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
