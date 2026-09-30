'use client';

import { useEffect, useState } from 'react';
import {
  canSpendExpress,
  getExpressSessionKey,
  type ExpressAllowance,
} from '@accensa/sdk/session/express';

interface ExpressCheckoutButtonProps {
  sessionId: string;
  amount: string;
  allowance: ExpressAllowance;
  onAuthorize: (input: { privateKey: string; amount: string }) => Promise<{ receiptId: string }>;
  onReceipt?: (receiptId: string) => void;
}

export function ExpressCheckoutButton({
  sessionId,
  amount,
  allowance,
  onAuthorize,
  onReceipt,
}: ExpressCheckoutButtonProps) {
  const [hasSession, setHasSession] = useState(false);
  const [status, setStatus] = useState<'idle' | 'authorizing' | 'complete' | 'error'>('idle');
  const [receiptId, setReceiptId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getExpressSessionKey(sessionId)
      .then((key) => active && setHasSession(key !== null))
      .catch(() => active && setHasSession(false));
    return () => {
      active = false;
    };
  }, [sessionId]);

  const withinAllowance = canSpendExpress(amount, allowance);
  if (!withinAllowance || !hasSession) return null;

  async function authorize() {
    setStatus('authorizing');
    setReceiptId(null);
    try {
      const privateKey = await getExpressSessionKey(sessionId);
      if (!privateKey) throw new Error('Express session is no longer available');
      const receipt = await onAuthorize({ privateKey, amount });
      setReceiptId(receipt.receiptId);
      setStatus('complete');
      onReceipt?.(receipt.receiptId);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={authorize}
        disabled={status === 'authorizing'}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:text-slate-950"
      >
        {status === 'authorizing' ? 'Authorizing…' : '1-Click Pay with Accensa'}
      </button>
      {status === 'complete' && receiptId && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
          Payment authorized. Receipt: <span className="font-mono">{receiptId}</span>
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          Authorization failed. No receipt was generated.
        </p>
      )}
    </div>
  );
}
