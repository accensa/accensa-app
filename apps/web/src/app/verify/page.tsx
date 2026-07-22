'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { VerifyResponse } from '../api/verify/route';

/**
 * Batch #1, anchored live on Stellar testnet. Lets anyone see the verifier work
 * end to end without first obtaining a receipt from a merchant.
 */
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
  | { status: 'done'; result: VerifyResponse }
  | { status: 'error'; message: string };

export default function VerifyPage() {
  const [batchId, setBatchId] = useState('');
  const [leaf, setLeaf] = useState('');
  const [proof, setProof] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

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
      setState({ status: 'done', result: body as VerifyResponse });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Request failed',
      });
    }
  }

  function loadSample(forged = false) {
    setBatchId(SAMPLE.batchId);
    setLeaf(forged ? FORGED_LEAF : SAMPLE.leaf);
    setProof(SAMPLE.proof);
    setState({ status: 'idle' });
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white px-6 py-16 md:py-24">
      <div className="fixed inset-0 overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-600/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-teal-600/20 blur-[120px]" />
      </div>

      <div className="max-w-3xl mx-auto space-y-10">
        <header className="space-y-4">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
            Verify a receipt
          </h1>
          <p className="text-gray-400 leading-relaxed">
            Check that a payment receipt really belongs to a batch anchored on
            Stellar. Your receipt is checked <strong className="text-gray-200">twice</strong>:
            recomputed here from the proof, and independently by the{' '}
            <code className="text-emerald-300">ReceiptAnchor</code> contract on
            the ledger. They must agree.
          </p>
          <p className="text-gray-500 text-sm">
            No account, no wallet, no signature. Both checks are read-only and
            cost nothing.
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => loadSample(false)}
            className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm hover:bg-emerald-500/20 transition-colors"
          >
            Load a valid sample
          </button>
          <button
            type="button"
            onClick={() => loadSample(true)}
            className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm hover:bg-white/10 transition-colors"
          >
            Load a forged receipt
          </button>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <Field label="Batch ID" hint="The anchored batch this receipt belongs to.">
            <input
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              inputMode="numeric"
              placeholder="1"
              required
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
            />
          </Field>

          <Field label="Receipt hash (leaf)" hint="Hex-encoded 32-byte hash of your receipt.">
            <input
              value={leaf}
              onChange={(e) => setLeaf(e.target.value)}
              placeholder="c476fc05…"
              required
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
            />
          </Field>

          <Field
            label="Merkle proof"
            hint="One sibling hash per line, ordered leaf to root. A single-receipt batch has an empty proof."
          >
            <textarea
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              rows={4}
              placeholder={'7ca64ee6…\n1733fad1…'}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
            />
          </Field>

          <button
            type="submit"
            disabled={state.status === 'checking'}
            className="px-6 py-3 rounded-lg bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {state.status === 'checking' ? 'Checking both sources…' : 'Verify receipt'}
          </button>
        </form>

        {state.status === 'error' && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-2">
            <p className="text-amber-400 font-medium">Could not verify</p>
            <p className="text-gray-400 text-sm">{state.message}</p>
          </div>
        )}

        {state.status === 'done' && <Result result={state.result} />}
      </div>
    </main>
  );
}

function Result({ result }: { result: VerifyResponse }) {
  const { local, onchain, verified, disagreement, batch } = result;

  return (
    <div className="space-y-6">
      <div
        className={`rounded-2xl border p-6 ${
          verified
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : 'border-red-500/30 bg-red-500/5'
        }`}
      >
        <p className={`text-lg font-semibold ${verified ? 'text-emerald-400' : 'text-red-400'}`}>
          {verified ? 'Receipt verified' : 'Receipt not verified'}
        </p>
        <p className="text-gray-400 text-sm mt-1">
          {verified
            ? 'Both an independent local recomputation and the on-chain contract agree this receipt is in the anchored batch.'
            : 'This receipt is not part of the anchored batch. Nothing was charged incorrectly by checking — the proof simply does not lead to the anchored root.'}
        </p>
      </div>

      {disagreement && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6">
          <p className="text-amber-300 font-semibold">The two checks disagree</p>
          <p className="text-gray-300 text-sm mt-1">
            This should never happen. The local implementation and the contract
            are pinned to the same conformance vectors. Please report it.
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <CheckCard
          title="Local recomputation"
          subtitle="Recomputed from your proof, in this process."
          result={local}
        />
        <CheckCard
          title="On-chain contract"
          subtitle="ReceiptAnchor.verify_receipt, read from the ledger."
          result={onchain}
        />
      </div>

      {batch && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-3">
          <p className="text-sm font-medium text-gray-300">Anchored batch #{batch.id}</p>
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            <Detail label="Merkle root" mono>
              {batch.root}
            </Detail>
            <Detail label="Receipts in batch">{batch.count}</Detail>
            <Detail label="Period start">
              {new Date(batch.periodStart * 1000).toLocaleString()}
            </Detail>
            <Detail label="Period end">
              {new Date(batch.periodEnd * 1000).toLocaleString()}
            </Detail>
          </dl>
          <a
            href={`https://stellar.expert/explorer/testnet/contract/${result.contract}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            View the contract on Stellar Expert ↗
          </a>
        </div>
      )}
    </div>
  );
}

function CheckCard({
  title,
  subtitle,
  result,
}: {
  title: string;
  subtitle: string;
  result: { ok: boolean | null; error?: string };
}) {
  const tone =
    result.ok === true
      ? 'text-emerald-400'
      : result.ok === false
        ? 'text-red-400'
        : 'text-amber-400';
  const label =
    result.ok === true ? 'Valid' : result.ok === false ? 'Not in batch' : 'Unavailable';

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-1">
      <p className="text-sm font-medium text-gray-300">{title}</p>
      <p className={`text-2xl font-semibold ${tone}`}>{label}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
      {result.error && <p className="text-xs text-amber-400/80 pt-1">{result.error}</p>}
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
      <span className="block text-sm font-medium text-gray-300">{label}</span>
      {children}
      <span className="block text-xs text-gray-500">{hint}</span>
    </label>
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
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className={`text-gray-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>
        {children}
      </dd>
    </div>
  );
}
