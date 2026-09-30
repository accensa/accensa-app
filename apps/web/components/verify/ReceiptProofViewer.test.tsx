// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReceiptProofViewer, { buildCertificate } from './ReceiptProofViewer';
import { buildAudit } from '../../src/lib/receipt-proof';
import type { VerifyResponse } from '../../src/app/api/verify/route';

const receipt = { batchId: 3, leaf: 'a'.repeat(64), txHash: 'b'.repeat(64) };
const result = (local: boolean, onchain: boolean): VerifyResponse => ({
  local: { ok: local },
  onchain: { ok: onchain },
  verified: local && onchain,
  disagreement: local !== onchain,
  contract: 'CANCHOR',
  batch: { id: 3, root: 'c'.repeat(64), count: 10, periodStart: 1, periodEnd: 2 },
});

describe('ReceiptProofViewer', () => {
  it('shows the green verified badge and full audit for a valid receipt', () => {
    const audit = buildAudit({ local: true, onchain: true }, 'valid', 'missing');
    render(<ReceiptProofViewer receipt={receipt} result={result(true, true)} audit={audit} />);
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Cryptographically Verified');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(4);
    expect(items[2]).toContain('Valid');
    expect(items[3]).toContain('Not included in receipt');
    expect(screen.getByRole('button', { name: 'Download certificate' })).toBeEnabled();
  });

  it('flags a forged receipt and blocks the certificate download', () => {
    const audit = buildAudit({ local: false, onchain: false }, 'valid', 'valid');
    render(<ReceiptProofViewer receipt={receipt} result={result(false, false)} audit={audit} />);
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Verification Failed');
    expect(screen.getByRole('button', { name: 'Download certificate' })).toBeDisabled();
  });

  it('flags a tampered signature even when the proof holds', () => {
    const audit = buildAudit({ local: true, onchain: true }, 'invalid', 'valid');
    render(<ReceiptProofViewer receipt={receipt} result={result(true, true)} audit={audit} />);
    expect(screen.getByTestId('verdict-badge')).toHaveTextContent('Verification Failed');
    expect(screen.getByText(/Invalid/)).toBeInTheDocument();
  });

  it('prints via window.print', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const audit = buildAudit({ local: true, onchain: true }, 'valid', 'valid');
    render(<ReceiptProofViewer receipt={receipt} result={result(true, true)} audit={audit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print certificate' }));
    expect(print).toHaveBeenCalledOnce();
  });
});

describe('buildCertificate', () => {
  it('records the verdict, anchor and checks', () => {
    const audit = buildAudit({ local: true, onchain: true }, 'valid', 'missing');
    const cert = buildCertificate(
      { receipt, result: result(true, true), audit },
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(cert).toMatchObject({
      verified: true,
      issuedAt: '2026-01-01T00:00:00.000Z',
      receipt: { batchId: 3, txHash: receipt.txHash },
      anchor: { contract: 'CANCHOR' },
      checks: { merkleProofOnChain: true, customerSignature: 'missing' },
    });
  });
});
