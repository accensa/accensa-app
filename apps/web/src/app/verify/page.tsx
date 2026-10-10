'use client';

import React, { useState } from 'react';
import { normalizeHex, validate } from './validators';
import type { VerifyResponse } from '../api/verify/route';
import { PageContainer } from '@/components/page-container';
import { formatTimestamp, toISO8601 } from '@/lib/format-timestamp';
import { CopyButton } from '@/components/copy-button';
import ReceiptProofViewer from '../../../components/verify/ReceiptProofViewer';
import {
  buildAudit,
  parseReceiptJson,
  verifyPartySignature,
  type AuditBreakdown,
  type ParsedReceipt,
} from '@/lib/receipt-proof';

const SAMPLE = {
  batchId: '1',
  leaf: 'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
  proof:
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1\n1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
};

const FORGED_LEAF = '16b138aabc889c21114436424e13132bd8928d2c21b4ac5a9ac5198104efb42c';

type State =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'done'; result: VerifyResponse; audit: AuditBreakdown }
  | { status: 'error'; message: string };

export default function VerifyPage() {
  const [batchId, setBatchId] = useState('');
  const [leaf, setLeaf] = useState('');
  const [proof, setProof] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const resultRef = React.useRef<HTMLDivElement>(null);
  const errorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (state.status === 'done') {
      resultRef.current?.focus();
    } else if (state.status === 'error') {
      errorRef.current?.focus();
    }
  }, [state.status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: 'checking' });
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: Number(batchId),
          leaf: leaf.trim(),
          proof: proof
            .split(/[\s,]+/)
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setState({ status: 'error', message: body.error ?? `Request failed (${res.status})` });
        return;
      }
      const result = body as VerifyResponse;
      // Signatures cover the leaf as it stands in the form, so editing the hash
      // after loading a file makes them fail rather than silently pass.
      const currentLeaf = normalizeHex(leaf);
      const [merchantSig, customerSig] = await Promise.all([
        verifyPartySignature(currentLeaf, receipt?.signatures.merchant),
        verifyPartySignature(currentLeaf, receipt?.signatures.customer),
      ]);
      setState({
        status: 'done',
        result,
        audit: buildAudit(
          { local: result.local.ok, onchain: result.onchain.ok },
          merchantSig,
          customerSig,
        ),
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Request failed',
      });
    }
  }

  async function loadFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    const parsed = parseReceiptJson(await file.text());
    if (!parsed.ok) {
      setReceipt(null);
      setFileError(parsed.error);
      return;
    }
    setReceipt(parsed.receipt);
    setBatchId(String(parsed.receipt.batchId));
    setLeaf(parsed.receipt.leaf);
    setProof(parsed.receipt.proof.join('\n'));
    setState({ status: 'idle' });
  }

  function loadSample(forged = false) {
    setReceipt(null);
    setFileError(null);
    setBatchId(SAMPLE.batchId);
    setLeaf(forged ? FORGED_LEAF : SAMPLE.leaf);
    setProof(SAMPLE.proof);
    setState({ status: 'idle' });
  }

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <PageContainer width="narrow" className="space-y-12">
        <header className="space-y-6 text-center max-w-2xl mx-auto relative">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
            Verify a Receipt
          </h1>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg transition-colors duration-300">
            Check that a payment receipt belongs to a batch anchored on Stellar. Checked twice:
            locally from the proof, and independently by the contract.
          </p>
        </header>

        {/* In-progress status live region for screen readers */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {state.status === 'checking' && 'Verification in progress. Please wait...'}
        </div>

        <div className="bg-white/50 dark:bg-white/5 backdrop-blur-2xl p-6 md:p-12 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
          <div className="flex flex-wrap gap-4 mb-8">
            <button
              type="button"
              onClick={() => loadSample(false)}
              className={`px-5 py-2.5 font-bold text-xs uppercase tracking-widest transition-colors ${
                batchId === SAMPLE.batchId && leaf === SAMPLE.leaf && proof === SAMPLE.proof
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                  : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10 shadow-sm dark:shadow-none'
              }`}
            >
              Valid Sample
            </button>
            <button
              type="button"
              onClick={() => loadSample(true)}
              className={`px-5 py-2.5 font-bold text-xs uppercase tracking-widest transition-colors ${
                batchId === SAMPLE.batchId && leaf === FORGED_LEAF && proof === SAMPLE.proof
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                  : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10 shadow-sm dark:shadow-none'
              }`}
            >
              Forged Sample
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void loadFile(e.dataTransfer.files[0]);
            }}
            className={`mb-8 border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'border-slate-300 dark:border-white/10'}`}
          >
            <label className="block cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">
              Drop a receipt JSON file here, or <span className="underline">browse</span>
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => void loadFile(e.target.files?.[0])}
              />
            </label>
            {receipt && (
              <p role="status" className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                Loaded receipt for batch #{receipt.batchId}
                {receipt.signatures.merchant || receipt.signatures.customer
                  ? ' with signatures.'
                  : '.'}
              </p>
            )}
            {fileError && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                {fileError}
              </p>
            )}
          </div>

          <form onSubmit={submit} className="space-y-8">
            <div className="grid md:grid-cols-2 gap-8">
              <Field label="Batch ID" hint="The anchored batch number.">
                <input
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  placeholder="1"
                  required
                  className="w-full bg-slate-50 dark:bg-[#0a111a] border border-slate-200 dark:border-white/10 px-5 py-4 font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-400 dark:focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-400 dark:focus:ring-0 transition-all shadow-sm dark:shadow-none"
                />
              </Field>

              <Field label="Receipt Hash (Leaf)" hint="Hex-encoded 32-byte hash.">
                <input
                  value={leaf}
                  onChange={(e) => setLeaf(e.target.value)}
                  placeholder="c476fc05…"
                  required
                  className="w-full bg-slate-50 dark:bg-[#0a111a] border border-slate-200 dark:border-white/10 px-5 py-4 font-mono text-emerald-600 dark:text-emerald-400 focus:outline-none focus:border-emerald-400 dark:focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-400 dark:focus:ring-0 transition-all shadow-sm dark:shadow-none"
                />
              </Field>
            </div>

            <Field label="Merkle Proof" hint="Sibling hashes, ordered leaf to root.">
              <textarea
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                rows={3}
                placeholder="7ca64ee6…&#10;1733fad1…"
                className="w-full bg-slate-50 dark:bg-[#0a111a] border border-slate-200 dark:border-white/10 px-5 py-4 font-mono text-slate-600 dark:text-slate-400 text-sm focus:outline-none focus:border-emerald-400 dark:focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-400 dark:focus:ring-0 transition-all shadow-sm dark:shadow-none resize-y leading-relaxed"
              />
            </Field>

            <button
              type="submit"
              disabled={state.status === 'checking'}
              aria-busy={state.status === 'checking'}
              className="w-full px-8 py-5 bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black font-black text-lg uppercase tracking-wider hover:bg-emerald-600 dark:hover:bg-emerald-400 disabled:opacity-50 transition-all shadow-md shadow-emerald-600/20 dark:shadow-[0_0_20px_rgba(16,185,129,0.2)]"
            >
              {state.status === 'checking' ? 'Processing...' : 'Verify Cryptographic Proof'}
            </button>
          </form>
        </div>

        {state.status === 'error' && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            aria-live="assertive"
            className="outline-none focus:ring-2 focus:ring-red-500 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-[#0a111a] p-6 flex gap-4 items-start shadow-sm dark:shadow-none transition-colors duration-300"
          >
            <div
              aria-hidden="true"
              className="w-8 h-8 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0"
            >
              ✕
            </div>
            <div>
              <h2 className="text-red-700 dark:text-red-400 font-bold transition-colors duration-300">
                Verification Error
              </h2>
              <p className="text-red-600 dark:text-red-400/80 text-sm mt-1 transition-colors duration-300">
                {state.message}
              </p>
            </div>
          </div>
        )}

        {state.status === 'done' && (
          <>
            <Result result={state.result} resultRef={resultRef} />
            <ReceiptProofViewer
              receipt={{
                batchId: Number(batchId),
                leaf: normalizeHex(leaf),
                txHash: receipt?.txHash,
              }}
              result={state.result}
              audit={state.audit}
            />
          </>
        )}
      </PageContainer>
    </main>
  );
}

function Result({
  result,
  resultRef,
}: {
  result: VerifyResponse;
  resultRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { local, onchain, verified, batch } = result;

  return (
    <div className="space-y-6 mt-12 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Verification verdict"
        aria-live="polite"
        className={`outline-none focus:ring-2 focus:ring-emerald-500 border p-6 md:p-12 transition-colors duration-300 ${verified ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-[#0a111a] shadow-lg shadow-emerald-600/10 dark:shadow-[0_0_50px_rgba(16,185,129,0.1)]' : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-[#0a111a] shadow-lg shadow-red-600/10 dark:shadow-[0_0_50px_rgba(239,68,68,0.1)]'}`}
      >
        <div className="flex items-center gap-4 mb-4">
          <div
            aria-hidden="true"
            className={`w-12 h-12 flex items-center justify-center text-xl font-bold transition-colors duration-300 ${verified ? 'bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black' : 'bg-red-600 dark:bg-red-500 text-white dark:text-black'}`}
          >
            {verified ? '✓' : '✕'}
          </div>
          <div>
            <h2
              className={`text-3xl font-black tracking-tight transition-colors duration-300 ${verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
            >
              <span className="sr-only">Verdict: </span>
              {verified ? 'Proof Verified' : 'Proof Rejected'}
            </h2>
          </div>
        </div>
        <p className="text-slate-600 dark:text-slate-400 text-lg transition-colors duration-300">
          {verified
            ? 'The receipt cryptographic proof accurately resolves to the anchored Merkle root on Stellar.'
            : 'This receipt is invalid. The cryptographic proof does not lead to the anchored batch root.'}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <CheckCard title="Local Compute" source="Recomputed in browser" result={local} />
        <CheckCard title="Ledger Contract" source="Queried from Stellar node" result={onchain} />
      </div>

      {batch && (
        <div className="border border-slate-200 dark:border-white/10 bg-white dark:bg-[#0a111a] p-6 md:p-8 space-y-6 shadow-md dark:shadow-none transition-colors duration-300">
          <p className="uppercase tracking-widest font-bold text-xs text-slate-400 dark:text-slate-500 mb-2 transition-colors duration-300">
            Anchored Batch Metadata
          </p>
          <div className="grid sm:grid-cols-2 gap-8">
            <Detail label="Batch ID" value={`#${batch.id}`} />
            <Detail label="Transaction Count" value={batch.count.toString()} />
            <Detail label="Period Start">
              <time
                dateTime={toISO8601(batch.periodStart * 1000)}
                title={toISO8601(batch.periodStart * 1000)}
                className="text-slate-900 dark:text-white font-medium text-lg"
              >
                {formatTimestamp(batch.periodStart * 1000)}
              </time>
            </Detail>
            <Detail label="Period End">
              <time
                dateTime={toISO8601(batch.periodEnd * 1000)}
                title={toISO8601(batch.periodEnd * 1000)}
                className="text-slate-900 dark:text-white font-medium text-lg"
              >
                {formatTimestamp(batch.periodEnd * 1000)}
              </time>
            </Detail>
            <div className="sm:col-span-2">
              <Detail label="Merkle Root" value={batch.root} mono copyable />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCard({
  title,
  source,
  result,
}: {
  title: string;
  source: string;
  result: { ok: boolean | null; error?: string };
}) {
  return (
    <div className="border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#0a111a] p-6 shadow-sm dark:shadow-none transition-colors duration-300">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-slate-900 dark:text-white font-bold text-lg transition-colors duration-300">
            {title}
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 transition-colors duration-300">
            {source}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border transition-colors duration-300 ${result.ok ? 'bg-emerald-50 dark:bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' : 'bg-red-50 dark:bg-red-500/5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'}`}
        >
          {result.ok ? (
            <span
              aria-hidden="true"
              className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 animate-pulse"
            />
          ) : (
            <span aria-hidden="true" className="w-1.5 h-1.5 bg-red-500 dark:bg-red-400" />
          )}
          <span>{result.ok ? 'Valid' : 'Failed'}</span>
        </div>
      </div>
      {result.error && (
        <p className="text-xs text-red-600 dark:text-red-400/80 font-mono mt-4 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-transparent p-3 dark:p-2 dark: transition-colors duration-300">
          {result.error}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 transition-colors duration-300">
          {label}
        </span>
      </div>
      {children}
      <span className="block text-xs font-medium text-slate-400 dark:text-slate-500 transition-colors duration-300">
        {hint}
      </span>
    </label>
  );
}

function Detail({
  label,
  value,
  mono,
  copyable,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  copyable?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 transition-colors duration-300">
          {label}
        </p>
        {copyable && value && <CopyButton value={value} label={label} />}
      </div>
      <p
        className={`transition-colors duration-300 ${mono ? 'text-slate-900 dark:text-white font-mono text-sm bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-transparent px-3 py-2 break-all' : 'text-slate-900 dark:text-white font-medium text-lg'}`}
      >
        {children ?? value}
      </p>
    </div>
  );
}
