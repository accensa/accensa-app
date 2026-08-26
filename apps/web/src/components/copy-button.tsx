'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, AlertCircle } from 'lucide-react';

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = 'value', className = '' }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(value);
      setStatus('copied');
      timerRef.current = setTimeout(() => {
        setStatus('idle');
      }, 2000);
    } catch {
      setStatus('error');
      timerRef.current = setTimeout(() => {
        setStatus('idle');
      }, 3000);
    }
  };

  const getStatusText = () => {
    if (status === 'copied') return `${label} copied to clipboard`;
    if (status === 'error') return `Failed to copy ${label}`;
    return '';
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={
          status === 'copied'
            ? `${label} copied`
            : status === 'error'
              ? `Failed to copy ${label}`
              : `Copy ${label}`
        }
        title={
          status === 'copied' ? 'Copied!' : status === 'error' ? 'Failed to copy' : `Copy ${label}`
        }
        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 transition-colors cursor-pointer"
      >
        {status === 'copied' ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Copied</span>
          </>
        ) : status === 'error' ? (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
            <span className="text-[10px] text-red-500 dark:text-red-400">Failed</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span className="text-[10px]">Copy</span>
          </>
        )}
      </button>

      {/* Screen reader live region */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {getStatusText()}
      </span>
    </div>
  );
}
