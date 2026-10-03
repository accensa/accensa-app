'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw, RotateCcw } from 'lucide-react';

interface DeliveryAttempt {
  attemptNumber: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

interface Delivery {
  id: number;
  paymentTxHash: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  attemptHistory: DeliveryAttempt[];
}

interface WebhookResponse {
  configured: boolean;
  pending: number;
  failed: number;
  deadLetter: number;
  delivered: number;
  lag: number;
  recentDeliveries: Delivery[];
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function statusClass(status: string): string {
  if (status === 'delivered') return 'text-emerald-700 dark:text-emerald-400';
  if (status === 'failed' || status === 'dead_letter') return 'text-rose-700 dark:text-rose-400';
  if (status === 'pending' || status === 'delivering') return 'text-amber-700 dark:text-amber-400';
  return 'text-slate-600 dark:text-slate-300';
}

export default function WebhookDeliveryViewer() {
  const [data, setData] = useState<WebhookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadDeliveries(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/webhooks', { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response, 'Could not load deliveries'));
      setData((await response.json()) as WebhookResponse);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not load webhook deliveries'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDeliveries();
  }, []);

  async function redeliver(id: number) {
    setRetryingId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/webhooks/${id}`, { method: 'POST' });
      if (!response.ok) throw new Error(await responseError(response, 'Could not queue redelivery'));
      setNotice(`Delivery ${id} queued for redelivery.`);
      await loadDeliveries(true);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not queue redelivery'));
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Webhook deliveries</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {data?.configured ? 'Endpoint configured' : 'Endpoint not configured'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDeliveries(true)}
          disabled={loading || refreshing}
          aria-label="Refresh webhook deliveries"
          title="Refresh deliveries"
          className="inline-flex size-9 items-center justify-center border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-white/20 dark:text-slate-200 dark:hover:bg-white/5"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {data && (
        <dl className="grid grid-cols-2 gap-4 border-y border-slate-200 py-4 sm:grid-cols-5 dark:border-white/10">
          {[
            ['Pending', data.pending],
            ['Delivered', data.delivered],
            ['Failed', data.failed],
            ['Dead letter', data.deadLetter],
            ['Ready to retry', data.lag],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase text-slate-500">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {error && (
        <div role="alert" className="border border-rose-300 p-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      {loading ? (
        <p role="status" className="py-8 text-sm text-slate-500">Loading webhook deliveries…</p>
      ) : error && !data ? (
        <button
          type="button"
          onClick={() => void loadDeliveries()}
          className="text-sm font-medium text-emerald-700 underline dark:text-emerald-400"
        >
          Try again
        </button>
      ) : !data?.recentDeliveries.length ? (
        <p className="border-y border-slate-200 py-8 text-sm text-slate-500 dark:border-white/10">
          No webhook deliveries recorded.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-white/10">
              <tr>
                <th className="py-3 pr-4 font-medium">Payment</th>
                <th className="py-3 pr-4 font-medium">Updated</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">HTTP</th>
                <th className="py-3 pr-4 font-medium">Attempts</th>
                <th className="py-3 text-right font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {data.recentDeliveries.map((delivery) => {
                const isExpanded = expandedId === delivery.id;
                const canRedeliver = ['failed', 'dead_letter'].includes(delivery.status);
                const latestAttempt = delivery.attemptHistory.at(-1);
                return (
                  <DeliveryRows
                    key={delivery.id}
                    delivery={delivery}
                    isExpanded={isExpanded}
                    latestAttempt={latestAttempt}
                    canRedeliver={canRedeliver}
                    retrying={retryingId === delivery.id}
                    onToggle={() => setExpandedId(isExpanded ? null : delivery.id)}
                    onRedeliver={() => void redeliver(delivery.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DeliveryRows({
  delivery,
  isExpanded,
  latestAttempt,
  canRedeliver,
  retrying,
  onToggle,
  onRedeliver,
}: {
  delivery: Delivery;
  isExpanded: boolean;
  latestAttempt: DeliveryAttempt | undefined;
  canRedeliver: boolean;
  retrying: boolean;
  onToggle: () => void;
  onRedeliver: () => void;
}) {
  return (
    <>
      <tr>
        <td className="py-3 pr-4 font-mono text-xs text-slate-700 dark:text-slate-300">
          {delivery.paymentTxHash.slice(0, 12)}…
        </td>
        <td className="py-3 pr-4 text-slate-600 dark:text-slate-400">
          {new Date(delivery.updatedAt).toLocaleString()}
        </td>
        <td className={`py-3 pr-4 capitalize ${statusClass(delivery.status)}`}>
          {statusLabel(delivery.status)}
        </td>
        <td className="py-3 pr-4 tabular-nums text-slate-700 dark:text-slate-300">
          {latestAttempt?.statusCode ?? delivery.lastStatusCode ?? '—'}
        </td>
        <td className="py-3 pr-4 tabular-nums text-slate-700 dark:text-slate-300">
          {delivery.attempts}
          {latestAttempt ? ` · ${latestAttempt.durationMs} ms` : ''}
        </td>
        <td className="py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Hide' : 'Show'} details for delivery ${delivery.id}`}
            className="inline-flex size-8 items-center justify-center text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          >
            <ChevronDown className={`size-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-4 dark:bg-white/[0.03]">
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Payload</h3>
                <pre className="max-h-72 overflow-auto border border-slate-200 p-3 text-xs text-slate-700 dark:border-white/10 dark:text-slate-300">
                  {JSON.stringify(delivery.payload, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Attempt history</h3>
                  {canRedeliver && (
                    <button
                      type="button"
                      onClick={onRedeliver}
                      disabled={retrying}
                      className="inline-flex items-center gap-2 border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-emerald-400/10"
                    >
                      <RotateCcw className="size-3.5" />
                      {retrying ? 'Queueing…' : 'Redeliver event'}
                    </button>
                  )}
                </div>
                {delivery.lastError && (
                  <p className="mb-3 text-xs text-rose-700 dark:text-rose-300">{delivery.lastError}</p>
                )}
                <ol className="divide-y divide-slate-200 dark:divide-white/10">
                  {delivery.attemptHistory.map((attempt) => (
                    <li key={attempt.attemptNumber} className="py-2 text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        Attempt {attempt.attemptNumber}
                      </span>
                      {' · '}{attempt.statusCode ?? 'No response'}{' · '}{attempt.durationMs} ms
                      {' · '}{new Date(attempt.createdAt).toLocaleString()}
                      {attempt.error && <p className="mt-1 text-rose-700 dark:text-rose-300">{attempt.error}</p>}
                    </li>
                  ))}
                  {delivery.attemptHistory.length === 0 && (
                    <li className="py-2 text-xs text-slate-500">No attempts yet.</li>
                  )}
                </ol>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}