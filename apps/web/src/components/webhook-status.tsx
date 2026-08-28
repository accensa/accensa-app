'use client';

import React, { useEffect, useState } from 'react';
import { useOnline } from '@/components/network-status';

interface Summary {
  configured: boolean;
  pending: number;
  failed: number;
  delivered: number;
  recentFailed: Array<{
    id: number;
    paymentTxHash: string;
    attempts: number;
    lastStatusCode: number | null;
    lastError: string | null;
  }>;
}

/**
 * Surfaces terminal webhook failures on the dashboard. A webhook that stopped
 * a week ago is the same class of failure as an indexer that stopped a week
 * ago — it must be visible, not swallowed in a catch block.
 */
export function WebhookStatus() {
  const online = useOnline();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    void fetch('/api/webhooks', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return;
        setSummary(await res.json());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [online]);

  if (!summary?.configured) return null;
  if (summary.failed === 0 && summary.pending === 0) return null;

  return (
    <section
      className="border border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/10 p-6 space-y-3"
      data-testid="webhook-status"
    >
      <h2 className="text-sm font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
        Webhook deliveries
      </h2>
      <p className="text-sm text-amber-900 dark:text-amber-200">
        {summary.failed > 0
          ? `${summary.failed} ${summary.failed === 1 ? 'delivery' : 'deliveries'} failed after the retry window.`
          : `${summary.pending} ${summary.pending === 1 ? 'delivery' : 'deliveries'} waiting to retry.`}
      </p>
      {summary.recentFailed.length > 0 && (
        <ul className="text-xs font-mono text-amber-900 dark:text-amber-200 space-y-1">
          {summary.recentFailed.slice(0, 5).map((row) => (
            <li key={row.id}>
              {row.paymentTxHash.slice(0, 8)}… · {row.attempts} attempt
              {row.attempts === 1 ? '' : 's'}
              {row.lastStatusCode ? ` · HTTP ${row.lastStatusCode}` : ''}
              {row.lastError ? ` · ${row.lastError}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
