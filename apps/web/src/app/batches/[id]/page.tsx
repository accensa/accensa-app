import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBatch, RECEIPT_ANCHOR_ID, type BatchRecord } from '@/lib/receipt-anchor';
import { explorerContractUrl } from '@/lib/explorer';
import { ArrowUpRight } from 'lucide-react';
import { PageContainer } from '@/components/page-container';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';

/**
 * A batch is immutable once anchored, so this can be cached hard. Revalidating
 * hourly is only to pick up batches anchored after a given page was built.
 */
export const revalidate = 3600;

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

async function load(raw: string): Promise<{ id: number; batch: BatchRecord } | null> {
  const id = parseId(raw);
  if (id === null) return null;
  try {
    return { id, batch: await getBatch(id) };
  } catch {
    // Either the batch was never anchored, or the ledger is unreachable. Both
    // render as"not found"rather than leaking an RPC error to a public page.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: raw } = await params;
  const found = await load(raw);
  if (!found) return { title: 'Batch not found - Accensa' };

  const title = `Batch #${found.id} - Accensa`;
  const description = `${found.batch.count} receipts anchored on Stellar. Merkle root ${found.batch.root.slice(0, 16)}…`;
  return { title, description, openGraph: { title, description } };
}

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const found = await load(raw);
  if (!found) notFound();

  const { id, batch } = found;
  const period = {
    start: new Date(batch.periodStart * 1000),
    end: new Date(batch.periodEnd * 1000),
  };

  return (
    <main className="min-h-screen bg-grid text-slate-900 dark:text-white px-6 py-16 md:py-24 pt-28 md:pt-32 transition-colors duration-300">
      <PageContainer width="narrow" className="space-y-10 relative z-10">
        <header className="space-y-4">
          <h1 className="text-4xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
            Batch{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-400 bg-clip-text text-transparent">
              #{id}
            </span>
          </h1>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg transition-colors duration-300">
            {batch.count} {batch.count === 1 ? 'receipt' : 'receipts'} anchored on Stellar. Anyone
            holding a receipt from this period can prove it belongs here - without an account, and
            without trusting the merchant.
          </p>
        </header>

        <div className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-12 mb-12 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
          <Detail label="Merkle root" mono>
            {batch.root}
          </Detail>
          <div className="grid sm:grid-cols-3 gap-6">
            <Detail label="Receipts">{batch.count}</Detail>
            <Detail label="Period start">
              <time dateTime={toISO8601(period.start)} title={toISO8601(period.start)}>
                {formatTimestamp(period.start)}
              </time>
            </Detail>
            <Detail label="Period end">
              <time dateTime={toISO8601(period.end)} title={toISO8601(period.end)}>
                {formatTimestamp(period.end)}
              </time>
            </Detail>
          </div>
          <Detail label="Contract" mono>
            {RECEIPT_ANCHOR_ID}
          </Detail>
        </div>

        <section className="flex flex-wrap gap-4">
          <Link
            href="/verify"
            className="px-6 py-3 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black font-black text-sm uppercase tracking-wider hover:bg-emerald-700 dark:hover:bg-emerald-400 transition-all shadow-md dark:shadow-none"
          >
            Verify a receipt in this batch
          </Link>
          <a
            href={explorerContractUrl(RECEIPT_ANCHOR_ID)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-6 py-3 border border-slate-200 dark:border-white/15 bg-white dark:bg-transparent text-slate-700 dark:text-slate-200 font-bold text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors shadow-sm dark:shadow-none"
          >
            View contract on Stellar Expert <ArrowUpRight className="w-4 h-4 opacity-70" />
          </a>
        </section>

        <section className="space-y-4 pt-6 border-t border-slate-200 dark:border-white/10 transition-colors duration-300">
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
            Check it yourself
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-base leading-relaxed transition-colors duration-300">
            Read the same batch straight from the ledger - no part of this page is taken on trust:
          </p>
          <div className="bg-white/40 dark:bg-black/20 backdrop-blur-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] relative group transition-colors duration-300">
            <pre className="p-6 text-sm font-mono">
              <code className="text-slate-700 dark:text-slate-300 leading-loose transition-colors duration-300">{`stellar contract invoke \\
 --id ${RECEIPT_ANCHOR_ID} \\
 --network testnet --source <your-identity> \\
 -- get_batch --batch_id ${id}`}</code>
            </pre>
          </div>
        </section>
      </PageContainer>
    </main>
  );
}

function Detail({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1 transition-colors duration-300">
        {label}
      </p>
      <p
        className={`text-slate-900 dark:text-white break-all transition-colors duration-300 ${mono ? 'font-mono text-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-transparent px-3 py-2 ' : 'font-medium text-lg'}`}
      >
        {children}
      </p>
    </div>
  );
}
