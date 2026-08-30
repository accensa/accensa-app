'use client';

import React from 'react';

type SkeletonVariant = 'card' | 'chart' | 'table' | 'stat';

interface WidgetSkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
  rows?: number;
}

function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300 ${className}`}
    >
      <div className="h-3 w-20 bg-slate-200 dark:bg-white/10 animate-pulse mb-4" />
      <div className="h-8 w-32 bg-slate-200 dark:bg-white/10 animate-pulse" />
    </div>
  );
}

function ChartSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300 ${className}`}
    >
      <div className="h-3 w-24 bg-slate-200 dark:bg-white/10 animate-pulse mb-4" />
      <div className="flex items-end gap-2 h-40">
        {[...Array(7)].map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-slate-200 dark:bg-white/10 animate-pulse"
            style={{ height: `${30 + Math.random() * 70}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-3">
        <div className="h-2 w-12 bg-slate-200 dark:bg-white/10 animate-pulse" />
        <div className="h-2 w-12 bg-slate-200 dark:bg-white/10 animate-pulse" />
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div
      className={`bg-white/50 dark:bg-white/5 backdrop-blur-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300 ${className}`}
    >
      <div className="px-8 py-6 bg-white/30 dark:bg-black/30 backdrop-blur-xl transition-colors duration-300">
        <div className="h-4 w-32 bg-slate-200 dark:bg-white/10 animate-pulse" />
      </div>
      <div className="p-8 space-y-4">
        {[...Array(rows)].map((_, i) => (
          <div
            key={i}
            className="h-12 bg-slate-100 dark:bg-white/5 animate-pulse transition-colors duration-300"
          />
        ))}
      </div>
    </div>
  );
}

function StatSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-8 flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden transition-colors duration-300 ${className}`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-[40px] dark:blur-[50px] pointer-events-none" />
      <div className="h-3 w-20 bg-slate-200 dark:bg-white/10 animate-pulse mb-4" />
      <div className="h-12 w-40 bg-slate-200 dark:bg-white/10 animate-pulse" />
    </div>
  );
}

export function WidgetSkeleton({ variant = 'card', className, rows }: WidgetSkeletonProps) {
  switch (variant) {
    case 'chart':
      return <ChartSkeleton className={className} />;
    case 'table':
      return <TableSkeleton rows={rows} className={className} />;
    case 'stat':
      return <StatSkeleton className={className} />;
    case 'card':
    default:
      return <CardSkeleton className={className} />;
  }
}
