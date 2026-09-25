'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface QrCountdownProps {
  expiresAt: Date;
  onExpire?: () => void;
  warningThreshold?: number; // seconds
}

export function QrCountdown({
  expiresAt,
  onExpire,
  warningThreshold = 30,
}: QrCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    const initial = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    return initial;
  });
  const [isWarning, setIsWarning] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000));
      setTimeLeft(remaining);
      setIsWarning(remaining > 0 && remaining <= warningThreshold);

      if (remaining === 0 && onExpire) {
        onExpire();
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, warningThreshold, onExpire]);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  if (timeLeft <= 0) {
    return (
      <div className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400">
        <span className="text-xs font-bold uppercase tracking-widest">Expired</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center gap-2 transition-all duration-300 ${
        isWarning
          ? 'text-red-600 dark:text-red-400 animate-pulse'
          : 'text-slate-600 dark:text-slate-300'
      }`}
    >
      <span className="text-xs font-bold uppercase tracking-widest">Expires in</span>
      <span className="text-lg font-black tracking-tight">{formatTime(timeLeft)}</span>
    </div>
  );
}
