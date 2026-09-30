import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ensureSchema, withClient } from '@/lib/db';
import { getPublicReceiptShare } from '@/lib/receipt-share';
import { isHash32 } from '@/lib/receipt-anchor';
import { assetLabel, formatAmount } from '@/lib/money';

export const dynamic = 'force-dynamic';

async function loadReceipt(txHash: string) {
  if (!process.env.DATABASE_URL || !isHash32(txHash)) return null;
  return withClient(async (client) => {
    await ensureSchema(client);
    return getPublicReceiptShare(client, txHash.toLowerCase());
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txHash: string }>;
}): Promise<Metadata> {
  const { txHash } = await params;
  const receipt = await loadReceipt(txHash);
  if (!receipt) return { title: 'Receipt unavailable | Accensa' };
  const image = `/api/og/receipt?txHash=${encodeURIComponent(receipt.txHash)}`;
  const amount = `${formatAmount(receipt.amount)} ${assetLabel(receipt.asset)}`;
  return {
    title: `Anchored payment receipt | Accensa`,
    description: `Publicly verifiable Stellar payment receipt for ${amount}.`,
    openGraph: {
      title: 'Payment confirmed',
      description: `Receipt anchored on Stellar · batch #${receipt.batchId}`,
      type: 'website',
      images: [{ url: image, width: 1200, height: 630, alt: `Anchored payment of ${amount}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Payment confirmed',
      description: `Receipt anchored on Stellar · batch #${receipt.batchId}`,
      images: [image],
    },
  };
}

export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ txHash: string }>;
}) {
  const { txHash } = await params;
  const receipt = await loadReceipt(txHash);
  if (!receipt) notFound();
  const merchant = `${receipt.merchantAddress.slice(0, 7)}…${receipt.merchantAddress.slice(-5)}`;

  return (
    <main className="min-h-screen px-5 pb-16 pt-32 text-slate-900 dark:text-slate-100">
      <article className="mx-auto max-w-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-10">
        <div className="flex items-center gap-4 border-b border-slate-200 pb-6 dark:border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/accensa-logo-no-bg.png"
            alt="Accensa merchant avatar"
            className="h-14 w-14 bg-emerald-50 object-contain p-2"
          />
          <div>
            <h1 className="text-xl font-bold">Payment confirmed</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{merchant}</p>
          </div>
          <span className="ml-auto border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300">
            Anchored on Stellar
          </span>
        </div>
        <p className="mt-8 text-sm text-slate-500">Public receipt amount</p>
        <p className="mt-2 text-4xl font-bold">
          {formatAmount(receipt.amount)}{' '}
          <span className="text-xl">{assetLabel(receipt.asset)}</span>
        </p>
        <p className="mt-3 text-sm text-slate-500">Receipt batch #{receipt.batchId}</p>
        <p className="mt-8 break-all border-t border-slate-200 pt-5 font-mono text-xs text-slate-500 dark:border-white/10">
          Transaction {receipt.txHash}
        </p>
        <Link
          href={`/api/receipts/${receipt.txHash}`}
          className="mt-6 inline-flex border border-emerald-700 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
        >
          Open receipt proof JSON
        </Link>
      </article>
    </main>
  );
}
