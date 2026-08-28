'use client';

import React from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Isolates a render-time crash to one part of the page.
 *
 * Next's `app/error.tsx` already catches anything thrown under the route, but
 * it replaces the *whole* page — a malformed API payload that makes one chart
 * throw would blank the settlements table next to it too. Wrapping each
 * independent widget in this boundary keeps a fault in one contained: the rest
 * of the dashboard stays usable, and the broken section shows a fallback with
 * a retry.
 *
 * Class component because `getDerivedStateFromError` / `componentDidCatch`
 * have no hook equivalent — this is the one place React still requires one.
 */
interface Props {
  children: React.ReactNode;
  /**
   * Rendered in place of `children` when they throw. Gets the error and a
   * `reset` that clears the boundary so the children re-mount and re-render.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /** Names the section in the default fallback and the console message. */
  label?: string;
  /** Called on every caught error, e.g. to forward to logging. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // No error-reporting service is wired up, so the console is where a stack
    // gets matched against logs — same as `app/error.tsx`.
    console.error(
      `[accensa] ${this.props.label ?? 'section'} failed to render`,
      error,
      info.componentStack,
    );
    this.props.onError?.(error, info);
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback label={this.props.label} onReset={this.reset} />;
  }
}

function DefaultFallback({ label, onReset }: { label?: string; onReset: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 border border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5 p-6 text-center transition-colors duration-300"
    >
      <TriangleAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {label ? `The ${label} could not be shown.` : 'This section could not be shown.'} The rest
        of the page is unaffected.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/5 transition-colors cursor-pointer"
      >
        Try again
      </button>
    </div>
  );
}
