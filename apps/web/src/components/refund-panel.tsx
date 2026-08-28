'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatAmount, assetLabel } from '@/lib/money';
import { readStatus, truncateAddress } from '@/lib/freighter';
import { submitRefund, type RefundOutcome } from '@/lib/refund-submit';
import { useOnline } from '@/components/network-status';
import type { RefundPreflightResponse } from '@/app/api/refund/preflight/route';

/**
 * Refunds one payment from the vault, from the payment's own detail view.
 *
 * The flow is deliberately preflight-first: the contract is asked whether the
 * refund would succeed *before* a signing prompt appears, so the merchant is
 * told "this window has closed" instead of approving a transaction that then
 * fails. Nothing here is signed by the server — Accensa holds no key that can
 * move a merchant's float, and a refund it could issue alone would make it a
 * custodian.
 */

interface RefundablePayment {
  tx_hash: string;
  payer: string;
  amount: string;
  asset: string | null;
  ledger: number | null;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ready'; check: RefundPreflightResponse }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: RefundOutcome };

export function RefundPanel({
  payment,
  onRefunded,
}: {
  payment: RefundablePayment;
  onRefunded: (txHash: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [merchant, setMerchant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();

  useEffect(() => {
    let live = true;
    void readStatus().then((status) => {
      if (live) setMerchant(status.kind === 'connected' ? status.address : null);
    });
    return () => {
      live = false;
    };
  }, []);

  const check = useCallback(async () => {
    if (!merchant || payment.ledger === null) return;
    if (!navigator.onLine) {
      setError('You are offline. Reconnect before checking a refund.');
      return;
    }
    setError(null);
    setPhase({ kind: 'checking' });
    try {
      const res = await fetch('/api/refund/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: payment.tx_hash,
          recipient: payment.payer,
          amount: payment.amount,
          paidAtLedger: payment.ledger,
          merchant,
        }),
      });
      if (!res.ok) throw new Error(`Preflight failed: ${res.status}`);
      setPhase({ kind: 'ready', check: await res.json() });
    } catch (e) {
      setPhase({ kind: 'idle' });
      setError(e instanceof Error ? e.message : 'Could not check this refund');
    }
  }, [merchant, payment]);

  const confirm = useCallback(async () => {
    if (!merchant || payment.ledger === null) return;
    if (!navigator.onLine) {
      setError('You are offline. Reconnect before signing a refund.');
      return;
    }
    setPhase({ kind: 'submitting' });
    const outcome = await submitRefund({
      txHash: payment.tx_hash,
      recipient: payment.payer,
      amount: payment.amount,
      paidAtLedger: payment.ledger,
      merchant,
    });
    setPhase({ kind: 'done', outcome });
    if (outcome.status === 'confirmed') onRefunded(payment.tx_hash);
  }, [merchant, payment, onRefunded]);

  const asset = assetLabel(payment.asset);

  if (!merchant) {
    return (
      <Note>
        Connect a Stellar wallet to issue refunds. The refund is signed by your own account —
        Accensa never holds a key that can move your float.
      </Note>
    );
  }

  if (payment.ledger === null) {
    return (
      <Note>
        This payment has no ledger recorded, so the vault cannot check it against the refund window.
        Refunds need an indexed ledger number.
      </Note>
    );
  }

  if (phase.kind === 'done') {
    return <Outcome outcome={phase.outcome} />;
  }

  if (phase.kind === 'ready') {
    const { existing, preflight } = phase.check;

    if (existing) {
      return (
        <Note tone="warn">
          Already refunded: {formatAmount(existing.amount)} {asset} to{' '}
          <span className="font-mono">{truncateAddress(existing.recipient)}</span> at ledger{' '}
          {existing.ledger}. A payment can only be refunded once.
        </Note>
      );
    }

    if (preflight.status === 'rejected') {
      return (
        <div className="space-y-3">
          <Note tone="warn">{preflight.message}</Note>
          <SmallButton onClick={check} disabled={!online}>
            Re-check
          </SmallButton>
        </div>
      );
    }

    if (preflight.status === 'unknown') {
      return (
        <div className="space-y-3">
          <Note tone="warn">
            Could not confirm whether this refund would succeed: {preflight.message}
          </Note>
          <SmallButton onClick={check} disabled={!online}>
            Retry check
          </SmallButton>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Note tone="ok">
          The vault will accept this refund: {formatAmount(payment.amount)} {asset} back to{' '}
          <span className="font-mono">{truncateAddress(payment.payer)}</span>. Checked against the
          live contract just now — float, refund window, and pause state all pass.
        </Note>
        {!online && (
          <Note tone="warn">
            You are offline. The refund cannot be signed or submitted until your connection returns.
          </Note>
        )}
        <div className="flex flex-wrap gap-3">
          <SmallButton onClick={confirm} tone="primary" disabled={!online}>
            Sign and refund
          </SmallButton>
          <SmallButton onClick={() => setPhase({ kind: 'idle' })}>Cancel</SmallButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <Note tone="warn">{error}</Note>}
      {!online && !error && (
        <Note tone="warn">
          You are offline. Refunds are unavailable until your connection returns.
        </Note>
      )}
      <SmallButton onClick={check} disabled={phase.kind === 'checking' || !online}>
        {phase.kind === 'checking' ? 'Checking…' : 'Refund this payment'}
      </SmallButton>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Signing as <span className="font-mono">{truncateAddress(merchant)}</span>. Nothing is
        submitted until you approve it in your wallet.
      </p>
    </div>
  );
}

function Outcome({ outcome }: { outcome: RefundOutcome }) {
  if (outcome.status === 'confirmed') {
    return (
      <Note tone="ok">
        Refund confirmed on-chain.{' '}
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${outcome.hash}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View transaction
        </a>
      </Note>
    );
  }
  if (outcome.status === 'pending') {
    return (
      <Note>
        Submitted, but not yet confirmed. It may still succeed — check the transaction before
        retrying, or you risk attempting a second refund the vault will reject.{' '}
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${outcome.hash}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View transaction
        </a>
      </Note>
    );
  }
  return <Note tone="warn">{outcome.message}</Note>;
}

function Note({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const tones = {
    neutral: 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300',
    ok: 'border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    warn: 'border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300',
  };
  return <p className={`text-xs leading-relaxed border p-3 ${tones[tone]}`}>{children}</p>;
}

function SmallButton({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        tone === 'primary'
          ? 'border-emerald-500/40 dark:border-emerald-500/30 bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 dark:hover:bg-emerald-500/30'
          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}
