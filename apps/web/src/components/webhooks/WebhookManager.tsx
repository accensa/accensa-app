'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RotateCcw } from 'lucide-react';

interface DeliveryAttempt {
  id: number;
  attemptNumber: number;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface Delivery {
  id: number;
  url: string;
  paymentTxHash: string;
  payload: unknown;
  status: string;
  attempts: number;
  attemptLog: DeliveryAttempt[];
  lastStatusCode: number | null;
  createdAt: string;
}

interface DeliveryResponse {
  configured: boolean;
  endpoint: string | null;
  signatureConfigured: boolean;
  deliveries: Delivery[];
}

function timeLabel(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 'Unknown time' : new Date(timestamp).toLocaleString();
}

function statusTone(status: string): string {
  if (status === 'delivered') return 'text-emerald-700 dark:text-emerald-300';
  if (status === 'pending' || status === 'delivering') return 'text-amber-700 dark:text-amber-300';
  return 'text-red-700 dark:text-red-300';
}

export default function WebhookManager() {
  const [data, setData] = useState<DeliveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [endpointDraft, setEndpointDraft] = useState('');
  const [savingEndpoint, setSavingEndpoint] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/webhooks/deliveries', { cache: 'no-store', signal });
      const body = (await response.json()) as DeliveryResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body);
      setEndpointDraft(body.endpoint ?? '');
      setError(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not load delivery history');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/webhooks/deliveries', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as DeliveryResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setData(body);
        setEndpointDraft(body.endpoint ?? '');
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not load delivery history');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function redeliver(deliveryId: number) {
    setRetrying(deliveryId);
    setError(null);
    try {
      const response = await fetch('/api/webhooks/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Redelivery failed (${response.status})`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not redeliver this event');
    } finally {
      setRetrying(null);
    }
  }

  async function saveEndpoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingEndpoint(true);
    setError(null);
    try {
      const response = await fetch('/api/merchant/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: endpointDraft.trim() || null }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Could not save endpoint (${response.status})`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save endpoint');
    } finally {
      setSavingEndpoint(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-sm text-slate-500 dark:text-slate-400" role="status">Loading webhook deliveries...</p>;
  }

  return (
    <section className="space-y-8" aria-labelledby="webhook-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/10">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
            Notifications
          </p>
          <h1 id="webhook-title" className="text-3xl font-black text-slate-900 dark:text-white">
            Webhook deliveries
          </h1>
        </div>
        <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          Signed with Ed25519
        </span>
      </header>

      {data?.configured && data.endpoint && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-emerald-500 bg-white/70 p-4 dark:bg-white/5">
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Active endpoint</h2>
            <a href={data.endpoint} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-sm text-slate-900 underline decoration-slate-400 underline-offset-4 dark:text-white">
              {data.endpoint}
            </a>
          </div>
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">Configured</span>
        </div>
      )}

      <form onSubmit={saveEndpoint} className="grid gap-3 border-y border-slate-200 py-5 dark:border-white/10 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label htmlFor="webhook-endpoint" className="mb-2 block text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
            Merchant endpoint
          </label>
          <input
            id="webhook-endpoint"
            type="url"
            value={endpointDraft}
            onChange={(event) => setEndpointDraft(event.target.value)}
            placeholder="https://merchant.example/webhooks"
            className="w-full border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 dark:border-white/15 dark:bg-black/20 dark:text-white"
          />
        </div>
        <button
          type="submit"
          disabled={savingEndpoint}
          className="border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:border-emerald-600 disabled:opacity-50 dark:border-white/15 dark:text-slate-200"
        >
          {savingEndpoint ? 'Saving...' : 'Save endpoint'}
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
          Event delivery signs payloads with HMAC-SHA256. The signing secret is never shown here; signing is {data?.signatureConfigured ? 'configured' : 'not configured'} for this deployment.
        </p>
      </form>

      {!data?.configured && (
        <p className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          No webhook endpoint is configured for this merchant.
        </p>
      )}

      {error && <p role="alert" className="border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">{error}</p>}

      {data?.deliveries.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">No delivery attempts recorded.</p>
      ) : (
        <div className="overflow-x-auto border-y border-slate-200 dark:border-white/10">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-slate-100/80 text-xs uppercase text-slate-600 dark:bg-white/5 dark:text-slate-300">
              <tr>
                <th scope="col" className="px-4 py-3">Created</th>
                <th scope="col" className="px-4 py-3">Payment</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">HTTP</th>
                <th scope="col" className="px-4 py-3">Duration</th>
                <th scope="col" className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {data?.deliveries.map((delivery) => {
                const lastAttempt = delivery.attemptLog[0];
                const retryable = delivery.status === 'failed' || delivery.status === 'dead_letter';
                return (
                  <tr key={delivery.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600 dark:text-slate-300">{timeLabel(delivery.createdAt)}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-700 dark:text-slate-200">
                      {delivery.paymentTxHash.slice(0, 10)}...{delivery.paymentTxHash.slice(-6)}
                      <details className="mt-2 max-w-[32rem]">
                        <summary className="cursor-pointer font-sans text-xs text-emerald-700 underline dark:text-emerald-300">View payload and attempts</summary>
                        <div className="mt-3 space-y-3">
                          <pre className="max-h-72 overflow-auto border border-slate-200 bg-slate-50 p-3 text-xs dark:border-white/10 dark:bg-black/30">
                            {JSON.stringify(delivery.payload, null, 2) ?? 'Payload unavailable'}
                          </pre>
                          <ol className="space-y-2 font-sans text-xs">
                            {delivery.attemptLog.map((attempt) => (
                              <li key={attempt.id} className="border-l border-slate-300 pl-3 dark:border-white/20">
                                Attempt {attempt.attemptNumber} | {timeLabel(attempt.createdAt)} | {attempt.statusCode ? `HTTP ${attempt.statusCode}` : 'No response'} | {attempt.durationMs === null ? 'Duration unavailable' : `${attempt.durationMs} ms`}
                                {attempt.error ? <span className="block text-red-700 dark:text-red-300">{attempt.error}</span> : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </details>
                    </td>
                    <td className={`px-4 py-4 font-bold capitalize ${statusTone(delivery.status)}`}>
                      {delivery.status.replace('_', ' ')}
                      <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">{delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-700 dark:text-slate-200">{delivery.lastStatusCode ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-700 dark:text-slate-200">{lastAttempt?.durationMs == null ? '—' : `${lastAttempt.durationMs} ms`}</td>
                    <td className="px-4 py-4">
                      {retryable && (
                        <button
                          type="button"
                          onClick={() => void redeliver(delivery.id)}
                          disabled={retrying !== null}
                          aria-label={`Redeliver event ${delivery.paymentTxHash}`}
                          className="inline-flex items-center gap-2 border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:border-emerald-600 hover:text-emerald-700 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:text-emerald-300"
                        >
                          {retrying === delivery.id ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
                          Redeliver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
