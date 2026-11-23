'use client';

import { useEffect, useState } from 'react';

type HealthStatus = 'ok' | 'warn' | 'critical';

interface MerchantHealth {
  merchantId: number;
  lastLedger: number | null;
  lastSyncedAt: string | null;
  lagLedgers: number | null;
  ageMs: number | null;
  status: HealthStatus;
  reasons: string[];
}

interface HealthResponse {
  status: HealthStatus;
  head?: number;
  checkedAt?: string;
  error?: string;
  merchants?: MerchantHealth[];
}

function syncAge(merchant: MerchantHealth): string {
  if (merchant.lastSyncedAt === null) return 'No cursor yet';

  let ageMs = merchant.ageMs;
  if (ageMs === null || !Number.isFinite(ageMs)) {
    ageMs = Date.parse(merchant.lastSyncedAt);
    if (!Number.isNaN(ageMs)) ageMs = Date.now() - ageMs;
  }
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return 'No cursor yet';

  const minutes = Math.round(ageMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isHealthResponse(body: unknown): body is HealthResponse {
  if (typeof body !== 'object' || body === null) return false;
  const status = (body as HealthResponse).status;
  return status === 'ok' || status === 'warn' || status === 'critical';
}

export function IndexerLagPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          signal: controller.signal,
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw new Error(`Could not load indexer health (${response.status})`);
        }

        if (!isHealthResponse(body)) {
          throw new Error(`Could not load indexer health (${response.status})`);
        }

        if (active && !controller.signal.aborted) {
          setData(body);
          setError(null);
        }
      } catch (cause) {
        if (controller.signal.aborted || !active) return;
        setError(cause instanceof Error ? cause.message : 'Could not load indexer health');
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const merchants = data?.merchants ?? [];
  const status = data?.status;
  const alerting = status !== undefined && status !== 'ok';

  return (
    <section
      aria-label="Indexer cursor lag"
      data-status={status ?? (error ? 'error' : 'loading')}
      className={`border p-6 ${
        alerting || error
          ? 'border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/5'
          : 'border-slate-200 dark:border-white/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Indexer cursor lag</h2>
        {status && (
          <p
            role={alerting ? 'alert' : undefined}
            className={`text-sm font-bold uppercase tracking-wider ${
              alerting ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Worst status: {status}
          </p>
        )}
      </div>

      {error ? (
        <div role="alert" className="mt-4 space-y-3 text-sm text-rose-700 dark:text-rose-300">
          <p>{error}</p>
          <button
            type="button"
            onClick={retry}
            className="px-3 py-1.5 border border-current font-bold uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <p role="status" className="mt-4 text-sm text-slate-500">
          Loading indexer health…
        </p>
      ) : (
        <>
          {data?.error && (
            <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{data.error}</p>
          )}
          {merchants.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No merchants reported.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-white/10">
              {merchants.map((merchant) => (
                <li key={merchant.merchantId} className="py-3 text-sm">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Merchant {merchant.merchantId}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Lag:{' '}
                    {merchant.lagLedgers === null
                      ? 'No cursor yet'
                      : `${merchant.lagLedgers.toLocaleString('en-US')} ledgers behind`}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Sync age: {syncAge(merchant)}
                  </p>
                  {merchant.reasons.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
                      {merchant.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={retry}
            className="mt-4 px-3 py-1.5 border border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-600 dark:border-white/10 dark:text-slate-300"
          >
            Retry
          </button>
        </>
      )}
    </section>
  );
}
