'use client';

import { useEffect } from 'react';

const RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function useSessionRenewal() {
  useEffect(() => {
    const renew = () => {
      void fetch('/api/auth/renew', { method: 'POST' });
    };
    const interval = window.setInterval(renew, RENEWAL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);
}
