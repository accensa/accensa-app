import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildBatch, receiptLeaf, verifyReceipt } from '@accensa/sdk';
import { buildPreview, selectionHashOf, unixSeconds, type AnchorablePayment } from './anchor';

function payment(overrides: Partial<AnchorablePayment> & { tx_hash: string }): AnchorablePayment {
  return {
    ledger: 100,
    payer: 'GABC',
    amount: '1500000',
    asset: 'native',
    ts: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function tx(n: number): string {
  return createHash('sha256').update(String(n)).digest('hex');
}

describe('unixSeconds', () => {
  it('converts an ISO timestamp to seconds, not milliseconds', () => {
    expect(unixSeconds('1970-01-01T00:00:01.000Z')).toBe(1);
    expect(unixSeconds('1970-01-01T00:00:01.900Z')).toBe(1);
  });
});

describe('selectionHashOf', () => {
  it('is stable for the same ordered set and sensitive to order', () => {
    const a = tx(1);
    const b = tx(2);
    expect(selectionHashOf([a, b])).toBe(selectionHashOf([a, b]));
    expect(selectionHashOf([a, b])).not.toBe(selectionHashOf([b, a]));
  });
});

describe('buildPreview', () => {
  it('throws when there is nothing to anchor', () => {
    expect(() => buildPreview([])).toThrow(/no unanchored payments/);
  });

  it('builds a tree whose proofs verify locally against the previewed root', () => {
    const payments = [
      payment({ tx_hash: tx(1), ledger: 10 }),
      payment({ tx_hash: tx(2), ledger: 11 }),
    ];
    const preview = buildPreview(payments);

    expect(preview.count).toBe(2);
    expect(preview.startLedger).toBe(10);
    expect(preview.endLedger).toBe(11);
    expect(preview.periodStart).toBe(unixSeconds(payments[0].ts));
    expect(preview.periodEnd).toBe(unixSeconds(payments[1].ts));

    const leaves = payments.map((p) => receiptLeaf(p.tx_hash));
    const independently = buildBatch(leaves);
    expect(preview.root).toBe(independently.root);

    for (const p of payments) {
      const { leaf, proof } = preview.proofs[p.tx_hash];
      expect(leaf).toBe(receiptLeaf(p.tx_hash));
      expect(verifyReceipt(leaf, proof, preview.root)).toBe(true);
    }
  });

  it('uses receiptLeaf(tx_hash) so a third party with only the hash can recompute it', () => {
    const hash = tx(9);
    const preview = buildPreview([payment({ tx_hash: hash })]);
    expect(preview.payments[0].leaf).toBe(receiptLeaf(hash));
    expect(preview.root).toBe(receiptLeaf(hash));
    expect(preview.proofs[hash].proof).toEqual([]);
  });
});
