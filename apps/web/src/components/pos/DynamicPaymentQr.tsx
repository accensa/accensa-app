'use client';

import React, { useState, useEffect, useCallback } from 'react';
import QRCode from '@qrcode/react';
import { QrCountdown } from './QrCountdown';
import { Copy, Check } from 'lucide-react';

interface DynamicPaymentQrProps {
  paymentUri: string;
  amount: string;
  asset: string;
  validitySeconds?: number;
  onPaymentConfirmed?: () => void;
}

type PaymentStatus = 'pending' | 'confirmed' | 'expired';

export function DynamicPaymentQr({
  paymentUri,
  amount,
  asset,
  validitySeconds = 300,
  onPaymentConfirmed,
}: DynamicPaymentQrProps) {
  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [expiresAt, setExpiresAt] = useState<Date>(
    () => new Date(Date.now() + validitySeconds * 1000)
  );
  const [showSuccess, setShowSuccess] = useState(false);

  const handleExpire = useCallback(() => {
    setStatus('expired');
  }, []);

  const handlePaymentConfirmed = useCallback(() => {
    setStatus('confirmed');
    setShowSuccess(true);
    onPaymentConfirmed?.();
    
    // Hide success animation after 3 seconds
    setTimeout(() => setShowSuccess(false), 3000);
  }, [onPaymentConfirmed]);

  // Simulate payment detection for demo purposes
  // In production, this would connect to a real payment listener
  useEffect(() => {
    if (status !== 'pending') return;

    const checkPayment = () => {
      // TODO: Replace with actual payment status check via API
      // For demo, randomly confirm payment after some time
      if (Math.random() > 0.995) {
        handlePaymentConfirmed();
      }
    };

    const interval = setInterval(checkPayment, 1000);
    return () => clearInterval(interval);
  }, [status, handlePaymentConfirmed]);

  const handleRefresh = () => {
    setStatus('pending');
    setExpiresAt(new Date(Date.now() + validitySeconds * 1000));
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* QR Code Container */}
      <div
        className={`relative bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-all duration-300 ${
          showSuccess
            ? 'ring-4 ring-emerald-500 ring-opacity-50 scale-105'
            : status === 'expired'
              ? 'opacity-50 grayscale'
              : ''
        }`}
      >
        {/* Success Animation Overlay */}
        {showSuccess && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10 backdrop-blur-sm rounded-2xl animate-in fade-in zoom-in duration-300">
            <div className="text-center">
              <div className="text-6xl mb-2">✓</div>
              <p className="text-emerald-600 dark:text-emerald-400 font-black text-lg">
                Payment Confirmed!
              </p>
            </div>
          </div>
        )}

        {/* Pulse Animation for Final 30 Seconds */}
        {status === 'pending' && !showSuccess && (
          <div className="absolute inset-0 rounded-2xl bg-emerald-500/5 animate-pulse" />
        )}

        <QRCode
          value={paymentUri}
          size={200}
          level="H"
          includeMargin={false}
          className="transition-opacity duration-300"
        />
      </div>

      {/* Payment Details */}
      <div className="text-center space-y-2">
        <p className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          {amount} {asset}
        </p>
        <QrCountdown expiresAt={expiresAt} onExpire={handleExpire} />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(paymentUri)}
          className="flex items-center gap-2 px-4 py-2 bg-white/40 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-bold hover:bg-white/60 dark:hover:bg-white/10 transition-colors rounded-lg"
        >
          <Copy className="w-4 h-4" />
          Copy Link
        </button>

        {status === 'expired' && (
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black text-sm font-bold hover:bg-emerald-500 dark:hover:bg-emerald-400 transition-colors rounded-lg"
          >
            Refresh QR
          </button>
        )}
      </div>

      {/* Status Indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            status === 'confirmed'
              ? 'bg-emerald-500'
              : status === 'expired'
                ? 'bg-red-500'
                : 'bg-amber-500 animate-pulse'
          }`}
        />
        <span className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
          {status === 'confirmed'
            ? 'Paid'
            : status === 'expired'
              ? 'Expired'
              : 'Awaiting Payment'}
        </span>
      </div>
    </div>
  );
}
