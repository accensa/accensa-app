import React from 'react';
import type { VerifyResponse } from '../../src/app/api/verify/route';
import type { AuditBreakdown, ParsedReceipt, SignatureStatus } from '../../src/lib/receipt-proof';

interface ReceiptProofViewerProps {
  receipt: Pick<ParsedReceipt, 'batchId' | 'leaf' | 'txHash'>;
  result: VerifyResponse;
  audit: AuditBreakdown;
}

const CHECK_TEXT = {
  true: 'Passed',
  false: 'Failed',
  null: 'Could not run',
} as const;

const SIG_TEXT: Record<SignatureStatus, string> = {
  valid: 'Valid',
  invalid: 'Invalid',
  missing: 'Not included in receipt',
  unsupported: 'Could not verify in this browser',
};

const sigPass = (s: SignatureStatus) => s === 'valid' || s === 'missing';

/** The machine-readable certificate a customer or auditor can keep. */
export function buildCertificate(props: ReceiptProofViewerProps, issuedAt = new Date()) {
  const { receipt, result, audit } = props;
  return {
    type: 'accensa.receipt-verification',
    verified: audit.verified,
    issuedAt: issuedAt.toISOString(),
    receipt: { batchId: receipt.batchId, leaf: receipt.leaf, txHash: receipt.txHash ?? null },
    anchor: { contract: result.contract, batch: result.batch ?? null },
    checks: {
      merkleProofLocal: audit.merkleLocal,
      merkleProofOnChain: audit.merkleOnChain,
      merchantSignature: audit.merchantSignature,
      customerSignature: audit.customerSignature,
    },
  };
}

export default function ReceiptProofViewer(props: ReceiptProofViewerProps) {
  const { receipt, audit } = props;

  const rows: Array<{ label: string; text: string; pass: boolean }> = [
    {
      label: 'Merkle proof (recomputed locally)',
      text: CHECK_TEXT[String(audit.merkleLocal) as keyof typeof CHECK_TEXT],
      pass: audit.merkleLocal === true,
    },
    {
      label: 'Merkle proof (on-chain anchor contract)',
      text: CHECK_TEXT[String(audit.merkleOnChain) as keyof typeof CHECK_TEXT],
      pass: audit.merkleOnChain === true,
    },
    {
      label: 'Merchant signature',
      text: SIG_TEXT[audit.merchantSignature],
      pass: sigPass(audit.merchantSignature),
    },
    {
      label: 'Customer signature',
      text: SIG_TEXT[audit.customerSignature],
      pass: sigPass(audit.customerSignature),
    },
  ];

  function download() {
    const blob = new Blob([JSON.stringify(buildCertificate(props), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accensa-receipt-certificate-batch-${receipt.batchId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-label="Receipt audit"
      className={`border p-6 md:p-8 space-y-6 ${audit.verified ? 'border-emerald-300 bg-emerald-50 dark:bg-[#0a111a]' : 'border-red-300 bg-red-50 dark:bg-[#0a111a]'}`}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <p
          data-testid="verdict-badge"
          className={`inline-flex items-center gap-2 px-4 py-2 font-black uppercase tracking-wider text-sm ${audit.verified ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}
        >
          <span aria-hidden="true">{audit.verified ? '✓' : '✕'}</span>
          {audit.verified ? 'Cryptographically Verified' : 'Verification Failed'}
        </p>
        <div className="flex gap-3 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-slate-300 bg-white text-slate-700"
          >
            Print certificate
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!audit.verified}
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest border border-slate-300 bg-white text-slate-700 disabled:opacity-40"
          >
            Download certificate
          </button>
        </div>
      </div>

      <dl className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Batch</dt>
          <dd className="font-medium">#{receipt.batchId}</dd>
        </div>
        {receipt.txHash && (
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Transaction
            </dt>
            <dd className="font-mono break-all">{receipt.txHash}</dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Receipt hash
          </dt>
          <dd className="font-mono break-all">{receipt.leaf}</dd>
        </div>
      </dl>

      <ul
        aria-label="Audit breakdown"
        className="divide-y divide-slate-200 border border-slate-200 bg-white"
      >
        {rows.map((row) => (
          <li key={row.label} className="flex justify-between gap-4 px-4 py-3 text-sm">
            <span>{row.label}</span>
            <span
              className={row.pass ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}
            >
              {row.pass ? '✓' : '✕'} {row.text}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Signature keys are those declared in the receipt file; they prove the receipt was signed by
        the holder of that key, not who that key belongs to.
      </p>
    </section>
  );
}
