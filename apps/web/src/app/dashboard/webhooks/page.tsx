import Link from 'next/link';
import { PageContainer } from '@/components/page-container';
import WebhookManager from '@/components/webhooks/WebhookManager';

export default function WebhooksPage() {
  return (
    <main className="min-h-screen bg-grid px-6 pb-16 pt-28 text-slate-700 dark:text-slate-200 md:px-12 md:pt-32">
      <PageContainer className="space-y-8">
        <Link
          href="/dashboard"
          className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-emerald-700 dark:text-slate-400 dark:hover:text-emerald-300"
        >
          Back to dashboard
        </Link>
        <WebhookManager />
      </PageContainer>
    </main>
  );
}
