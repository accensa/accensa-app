'use client';

import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: React.ReactNode;
  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  loading = false,
}: MetricCardProps) {
  return (
    <div className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative overflow-hidden transition-colors duration-300">
      <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 blur-[30px] dark:blur-[40px] pointer-events-none" />
      
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-1">
            {title}
          </p>
          {loading ? (
            <div className="h-10 w-32 bg-slate-200 dark:bg-white/10 animate-pulse rounded" />
          ) : (
            <span className="text-3xl sm:text-4xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
              {value}
            </span>
          )}
        </div>
        {icon && <div className="text-slate-500 dark:text-slate-400">{icon}</div>}
      </div>

      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
          {subtitle}
        </p>
      )}

      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <span
            className={`text-xs font-bold ${
              trend.isPositive
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            vs last period
          </span>
        </div>
      )}
    </div>
  );
}
