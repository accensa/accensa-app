'use client';

import { useEffect, useState } from 'react';
import {
  canSpendExpress,
  getExpressSessionKey,
  type ExpressAllowance,
} from '@accensa/sdk/session/express';
import { SoundToggle } from '@/components/common/SoundToggle';
import { playSoundEffect } from '@/lib/audio/soundEffects';
import { StockIndicator } from './StockIndicator';

interface CheckoutInventoryItem {
  sku: string;
  quantity: number;
}

interface CheckoutInventory {
  merchantId: number;
  items: CheckoutInventoryItem[];
}

interface ExpressCheckoutButtonProps {
  sessionId: string;
  amount: string;
  allowance: ExpressAllowance;
  inventory?: CheckoutInventory;
  onAuthorize: (input: { privateKey: string; amount: string }) => Promise<{ receiptId: string }>;
  onReceipt?: (receiptId: string) => void;
}

export function ExpressCheckoutButton({
  sessionId,
  amount,
  allowance,
  inventory,
  onAuthorize,
  onReceipt,
}: ExpressCheckoutButtonProps) {
  const [hasSession, setHasSession] = useState(false);
  const [status, setStatus] = useState<'idle' | 'authorizing' | 'complete' | 'error'>('idle');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [stockLevels, setStockLevels] = useState<
    Array<{ sku: string; available: number; lowStockThreshold: number }>
  >([]);
  const inventorySkuQuery = inventory?.items
    .map(({ sku }) => `sku=${encodeURIComponent(sku)}`)
    .join('&');
  const inventoryUrl =
    inventory && inventorySkuQuery
      ? `/api/inventory/${inventory.merchantId}?${inventorySkuQuery}`
      : null;

  useEffect(() => {
    let active = true;
    getExpressSessionKey(sessionId)
      .then((key) => active && setHasSession(key !== null))
      .catch(() => active && setHasSession(false));
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!inventoryUrl) return;
    let active = true;
    const loadStock = async () => {
      try {
        const response = await fetch(inventoryUrl, { cache: 'no-store' });
        if (!response.ok) return;
        const result = (await response.json()) as {
          items?: Array<{ sku: string; available: number; lowStockThreshold: number }>;
        };
        if (active) setStockLevels(result.items ?? []);
      } catch {
        // Reservation is revalidated before payment; the display may be stale.
      }
    };
    void loadStock();
    const interval = window.setInterval(() => void loadStock(), 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [inventoryUrl]);

  const withinAllowance = canSpendExpress(amount, allowance);
  if (!withinAllowance || !hasSession) return null;

  async function authorize() {
    playSoundEffect('click');
    setStatus('authorizing');
    setReceiptId(null);
    let reservationId: string | null = null;
    try {
      const privateKey = await getExpressSessionKey(sessionId);
      if (!privateKey) throw new Error('Express session is no longer available');
      if (inventory?.items.length) {
        const response = await fetch('/api/inventory/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantId: inventory.merchantId,
            checkoutId: crypto.randomUUID(),
            items: inventory.items,
          }),
        });
        const result = (await response.json()) as { reservationId?: string; error?: string };
        if (!response.ok || !result.reservationId) {
          throw new Error(result.error ?? 'This item is no longer available');
        }
        reservationId = result.reservationId;
      }
      const receipt = await onAuthorize({ privateKey, amount });
      if (reservationId) void finishReservation(reservationId, 'commit');
      playSoundEffect('success');
      setReceiptId(receipt.receiptId);
      setStatus('complete');
      onReceipt?.(receipt.receiptId);
    } catch {
      if (reservationId) void finishReservation(reservationId, 'release');
      playSoundEffect('error');
      setStatus('error');
    }
  }

  function finishReservation(reservationId: string, action: 'commit' | 'release') {
    return fetch(`/api/inventory/reservations/${reservationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: inventory?.merchantId, action }),
    }).catch(() => undefined);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={authorize}
          disabled={status === 'authorizing'}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:text-slate-950"
        >
          {status === 'authorizing' ? 'Authorizing…' : '1-Click Pay with Accensa'}
        </button>
        <SoundToggle />
      </div>
      {inventory?.items.map((item) => {
        const stock = stockLevels.find((level) => level.sku === item.sku);
        return stock ? (
          <div key={item.sku} className="flex items-center justify-between text-sm">
            <span>{item.sku}</span>
            <StockIndicator
              available={stock.available}
              lowStockThreshold={stock.lowStockThreshold}
            />
          </div>
        ) : null;
      })}
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
