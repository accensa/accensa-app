'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { readStatus, connect, FREIGHTER_INSTALL_URL } from '@/lib/freighter';
import { submitAnchor, type AnchorOutcome } from '@/lib/anchor-submit';
import type { AnchorPreview, AnchorStatus } from '@/lib/anchor';

type PreviewResponse =
  | (AnchorPreview & {
      merchant: string;
      contractId: string;
      networkPassphrase: string;
      maxBatchSize: number;
    })
  | { count: 0; merchant: string };

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'preview'; preview: Exclude<PreviewResponse, { count: 0 }> }
  | { kind: 'signing'; preview: Exclude<PreviewResponse, { count: 0 }> }
  | {
      kind: 'recording';
      preview: Exclude<PreviewResponse, { count: 0 }>;
      batchId: number;
      hash: string;
    }
  | { kind: 'done'; batchId: number; hash: string }
  | { kind: 'pending'; hash: string };

/**
 * The producer side of the receipt loop: select unanchored payments, preview
 * the root, sign `anchor_batch`, persist proofs.
 *
 * Preview is a separate step from the wallet prompt on purpose. Anchoring is
 * irreversible and costs a fee; the merchant should see the count, period and
 * root before Freighter appears.
 */
export function AnchorPanel() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setError(null);
    setPhase({ kind: 'loading' });
    try {
      const res = await fetch('/api/anchor/preview', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Preview failed (${res.status})`);
      if (!body.count) {
        setPhase({ kind: 'empty' });
        return;
      }
      setPhase({ kind: 'preview', preview: body });
    } catch (e) {
      setPhase({ kind: 'idle' });
      setError(e instanceof Error ? e.message : 'Could not build a preview');
    }
  }, []);

  const confirm = useCallback(async (preview: Exclude<PreviewResponse, { count: 0 }>) => {
    setError(null);

    if (
      preview.existing &&
      preview.existing.status === 'recorded' &&
      preview.existing.batchId > 0
    ) {
      setPhase({
        kind: 'done',
        batchId: preview.existing.batchId,
        hash: preview.existing.anchorTx ?? '',
      });
      return;
    }

    if (
      preview.existing &&
      preview.existing.status === 'submitted' &&
      preview.existing.batchId > 0
    ) {
      setPhase({
        kind: 'recording',
        preview,
        batchId: preview.existing.batchId,
        hash: preview.existing.anchorTx ?? '',
      });
      await record(preview, preview.existing.batchId, preview.existing.anchorTx ?? '');
      return;
    }

    const wallet = await readStatus();
    if (wallet.kind === 'unavailable') {
      setError('Freighter is not installed. Install it, then come back to sign.');
      return;
    }
    if (wallet.kind !== 'connected') {
      const connected = await connect();
      if (connected.kind !== 'connected') {
        setError('Freighter did not approve this site. Nothing was submitted.');
        return;
      }
    }

    setPhase({ kind: 'signing', preview });
    const outcome: AnchorOutcome = await submitAnchor({
      root: preview.root,
      count: preview.count,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      merchant: preview.merchant,
    });

    if (outcome.status === 'failed') {
      setPhase({ kind: 'preview', preview });
      setError(outcome.message);
      return;
    }
    if (outcome.status === 'pending') {
      setPhase({ kind: 'pending', hash: outcome.hash });
      return;
    }

    setPhase({ kind: 'recording', preview, batchId: outcome.batchId, hash: outcome.hash });
    await record(preview, outcome.batchId, outcome.hash);
  }, []);

  const record = async (
    preview: Exclude<PreviewResponse, { count: 0 }>,
    batchId: number,
    hash: string,
  ) => {
    try {
      const res = await fetch('/api/anchor/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectionHash: preview.selectionHash,
          root: preview.root,
          batchId,
          anchorTx: hash,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Recording failed (${res.status})`);
      setPhase({ kind: 'done', batchId, hash });
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : 'Recording failed'}. The batch is on-chain as #${batchId}; retry recording without submitting again.`,
      );
      setPhase({ kind: 'preview', preview });
    }
  };

  return (
    <section className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-8 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
            Receipts
          </p>
          <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
            Anchor a batch
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            Select unanchored payments, preview the Merkle root, then sign
            <code className="mx-1 text-xs">anchor_batch</code>
            with Freighter. Anchoring is irreversible and costs a network fee.
          </p>
        </div>
        {phase.kind === 'idle' || phase.kind === 'empty' ? (
          <button
            type="button"
            onClick={loadPreview}
            className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
          >
            {phase.kind === 'empty' ? 'Check again' : 'Preview unanchored'}
          </button>
        ) : null}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}{' '}
          {/not installed/i.test(error) && (
            <a href={FREIGHTER_INSTALL_URL} className="underline" target="_blank" rel="noreferrer">
              Install Freighter
            </a>
          )}
        </p>
      )}

      {phase.kind === 'loading' && (
        <p className="text-sm text-slate-500 animate-pulse">Building the tree…</p>
      )}

      {phase.kind === 'empty' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing unanchored. Indexed payments that are not already in a recorded batch will appear
          here.
        </p>
      )}

      {phase.kind === 'pending' && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Transaction submitted ({phase.hash.slice(0, 8)}…) but not yet confirmed. Wait for the
          ledger, then preview again — a submitted selection is recorded without a second signature.
        </p>
      )}

      {(phase.kind === 'preview' || phase.kind === 'signing' || phase.kind === 'recording') && (
        <PreviewCard
          preview={phase.preview}
          busy={phase.kind !== 'preview'}
          onConfirm={() => void confirm(phase.preview)}
          onCancel={() => {
            setError(null);
            setPhase({ kind: 'idle' });
          }}
        />
      )}

      {phase.kind === 'done' && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Batch #{phase.batchId} recorded. Proofs are now serveable.
          </p>
          <Link
            href={`/batches/${phase.batchId}`}
            className="inline-block text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            View batch #{phase.batchId} →
          </Link>
        </div>
      )}
    </section>
  );
}

function PreviewCard({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: Exclude<PreviewResponse, { count: 0 }>;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const already: AnchorStatus | undefined = preview.existing?.status;
  const label =
    already === 'recorded'
      ? 'Already anchored'
      : already === 'submitted'
        ? 'Finish recording'
        : busy
          ? 'Working…'
          : 'Sign and submit';

  return (
    <div className="space-y-4">
      <dl className="grid sm:grid-cols-3 gap-4">
        <Stat label="Receipts" value={String(preview.count)} />
        <Stat label="Ledgers" value={`${preview.startLedger} – ${preview.endLedger}`} />
        <Stat
          label="Period"
          value={`${new Date(preview.periodStart * 1000).toLocaleString()} → ${new Date(preview.periodEnd * 1000).toLocaleString()}`}
        />
      </dl>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
          Merkle root
        </p>
        <p className="font-mono text-xs break-all bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2 text-slate-800 dark:text-slate-200">
          {preview.root}
        </p>
      </div>
      {already === 'recorded' && (
        <p className="text-sm text-slate-500">
          This exact selection is already batch #{preview.existing?.batchId}. Submitting again will
          not create a second batch.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-5 py-2.5 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black font-black text-xs uppercase tracking-wider hover:bg-emerald-700 dark:hover:bg-emerald-400 disabled:opacity-50"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-5 py-2.5 border border-slate-200 dark:border-white/10 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-1 break-all">{value}</dd>
    </div>
  );
}
