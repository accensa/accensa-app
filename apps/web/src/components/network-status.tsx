'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { OFFLINE_MESSAGE } from '@/lib/network-status';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = () => navigator.onLine;

// The server has no idea whether the client has a connection, and rendering
// "offline" into the HTML would flash on every cold load. Assume online and let
// the first client snapshot correct it.
const getServerSnapshot = () => true;

/**
 * Whether the browser currently has a network connection.
 *
 * `useSyncExternalStore` rather than useState + useEffect so the value is read
 * during render instead of one paint late: a page loaded from bfcache while
 * offline would otherwise enable its buttons for a frame.
 *
 * Only trustworthy when false. A browser reports online for any working link,
 * including a captive portal that reaches nothing, so this gates the UI but is
 * never taken as proof a request will succeed.
 */
export function useOnline(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeVisibility(onChange: () => void) {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
  };
}

const getVisibilitySnapshot = () =>
  typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

const getServerVisibilitySnapshot = () => true;

/**
 * Whether the current document/tab is visible to the user.
 *
 * Backed by `document.visibilityState` via `useSyncExternalStore`.
 * Returns false when the tab is in the background or hidden, and true when visible.
 */
export function useVisibility(): boolean {
  return React.useSyncExternalStore(
    subscribeVisibility,
    getVisibilitySnapshot,
    getServerVisibilitySnapshot,
  );
}

/**
 * Persistent notice while the browser has no connection.
 *
 * Deliberately not a toast: the condition lasts until it is fixed, and a notice
 * that dismisses itself after a few seconds would leave a merchant reading
 * stale totals with no indication they are stale.
 *
 * Sits bottom-left so it clears the fixed nav, and stops short of the right
 * edge on mobile so it does not sit under the floating menu button.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-6 right-24 md:right-auto md:max-w-sm z-[70] flex items-start gap-3 px-4 py-3 bg-amber-50/90 dark:bg-amber-500/10 backdrop-blur-2xl border border-amber-300 dark:border-amber-400/20 text-amber-900 dark:text-amber-200 shadow-[0_8px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)] transition-colors duration-300"
    >
      <WifiOff className="w-4 h-4 mt-0.5 shrink-0 opacity-80" />
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-widest">Network disconnected</p>
        <p className="text-sm leading-snug">{OFFLINE_MESSAGE}</p>
      </div>
    </div>
  );
}
