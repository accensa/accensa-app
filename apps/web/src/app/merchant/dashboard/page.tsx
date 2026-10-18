'use client';

import { useOnline } from '@/components/network-status';
import { formatAmount, assetLabel } from '@/lib/money';
import useSWR from 'swr';

interface DashboardPaymentsResponse {
  payments: Array<{
    tx_hash: string;
    amount: string;
    asset: string | null;
    route: string | null;
    ts: string;
  }>;
}

async function fetchPayments(url: string): Promise<DashboardPaymentsResponse> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load payments (${res.status})`);
  return res.json();
}

export default function MerchantDashboard() {
  const online = useOnline();
  const { data, error, isLoading } = useSWR<DashboardPaymentsResponse>(
    online ? '/api/payments?limit=5' : null,
    fetchPayments,
    { refreshInterval: 15000 },
  );

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <div className="space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400 font-bold text-xs mb-3">
              Merchant Dashboard
            </p>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
              Merchant dashboard
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/40 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full">
              <div className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {online ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </header>

        <section className="border-y border-slate-200 py-6 dark:border-white/10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Recent incoming payments
          </h2>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">
              {error.message}
            </p>
          ) : isLoading ? (
            <p role="status" className="mt-4 text-sm text-slate-500">
              Loading payments…
            </p>
          ) : !data?.payments.length ? (
            <p className="mt-4 text-sm text-slate-500">No payments recorded.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-white/10">
              {data.payments.map((payment) => (
                <li key={payment.tx_hash} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {formatAmount(payment.amount)} {assetLabel(payment.asset)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {payment.route || 'Unattributed'}
                    </p>
                  </div>
                  <time
                    className="shrink-0 text-xs text-slate-500 dark:text-slate-400"
                    dateTime={payment.ts}
                  >
                    {new Date(payment.ts).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
