'use client';

import React from 'react';
import { ErrorBoundary } from '@/components/error-boundary';

/**
 * Dashboard layout wrapper that isolates render-time crashes.
 *
 * Next.js error.tsx catches route-level errors but replaces the entire page.
 * This layout wraps the dashboard content in an ErrorBoundary so that a crash
 * in one widget (e.g., revenue chart) doesn't take down the entire dashboard.
 * The rest of the page remains usable, and the broken section shows a fallback
 * with a retry button.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      label="dashboard"
      fallback={(error, reset) => (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
              <span className="text-2xl text-red-600 dark:text-red-400">!</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Something went wrong
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              The dashboard encountered an unexpected error. Your data is safe — this is a display
              issue, not a data issue.
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-mono">
              {error.message}
            </p>
            <button
              type="button"
              onClick={reset}
              className="px-6 py-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-sm font-bold hover:bg-slate-50 dark:hover:bg-white/10 hover:border-slate-300 dark:hover:border-white/20 transition-colors shadow-sm dark:shadow-none cursor-pointer"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
