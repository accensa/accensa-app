import Link from 'next/link';
import WebhookDeliveryViewer from '@/components/webhooks/WebhookDeliveryViewer';

export default function MerchantWebhooksPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-10 pt-28 text-slate-900 dark:text-slate-100">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6 dark:border-white/10">
        <div>
          <p className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400">
            Merchant settings
          </p>
          <h1 className="mt-2 text-2xl font-bold">Webhook delivery log</h1>
        </div>
        <Link
          className="text-sm text-slate-600 underline underline-offset-4 dark:text-slate-300"
          href="/dashboard"
        >
          Dashboard
        </Link>
      </header>
      <WebhookDeliveryViewer />
    </main>
  );
}
