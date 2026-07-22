import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBatch, RECEIPT_ANCHOR_ID, type BatchRecord } from '@/lib/receipt-anchor';

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
    // render as "not found" rather than leaking an RPC error to a public page.
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
  if (!found) return { title: 'Batch not found — Accensa' };

  const title = `Batch #${found.id} — Accensa`;
  const description = `${found.batch.count} receipts anchored on Stellar. Merkle root ${found.batch.root.slice(0, 16)}…`;
  return { title, description, openGraph: { title, description } };
}

export default async function BatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const found = await load(raw);
  if (!found) notFound();

  const { id, batch } = found;
  const period = {
    start: new Date(batch.periodStart * 1000),
    end: new Date(batch.periodEnd * 1000),
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white px-6 py-16 md:py-24">
      <div className="fixed inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-600/20 blur-[120px]" />
      </div>

      <div className="max-w-3xl mx-auto space-y-10">
        <header className="space-y-4">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            ← Accensa
          </Link>
          <h1 className="text-4xl font-bold tracking-tight">
            Batch{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              #{id}
            </span>
          </h1>
          <p className="text-gray-400 leading-relaxed">
            {batch.count} {batch.count === 1 ? 'receipt' : 'receipts'} anchored on
            Stellar. Anyone holding a receipt from this period can prove it belongs
            here — without an account, and without trusting the merchant.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
          <Detail label="Merkle root" mono>
            {batch.root}
          </Detail>
          <div className="grid sm:grid-cols-3 gap-5">
            <Detail label="Receipts">{batch.count}</Detail>
            <Detail label="Period start">{period.start.toLocaleString()}</Detail>
            <Detail label="Period end">{period.end.toLocaleString()}</Detail>
          </div>
          <Detail label="Contract" mono>
            {RECEIPT_ANCHOR_ID}
          </Detail>
        </section>

        <section className="flex flex-wrap gap-3">
          <Link
            href="/verify"
            className="px-5 py-2.5 rounded-lg bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-colors"
          >
            Verify a receipt in this batch
          </Link>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${RECEIPT_ANCHOR_ID}`}
            target="_blank"
            rel="noreferrer"
            className="px-5 py-2.5 rounded-lg border border-white/15 text-gray-200 text-sm hover:bg-white/5 transition-colors"
          >
            View contract on Stellar Expert ↗
          </a>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Check it yourself</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Read the same batch straight from the ledger — no part of this page is
            taken on trust:
          </p>
          <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-5 text-xs">
            <code className="text-gray-300">{`stellar contract invoke \\
  --id ${RECEIPT_ANCHOR_ID} \\
  --network testnet --source <your-identity> \\
  -- get_batch --batch_id ${id}`}</code>
          </pre>
        </section>
      </div>
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
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-gray-200 break-all ${mono ? 'font-mono text-xs pt-1' : 'pt-0.5'}`}>
        {children}
      </p>
    </div>
  );
}
