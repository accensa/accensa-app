import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const client = { query };

vi.mock('pg', () => ({ Client: vi.fn() }));

import { recordAnchoredBatch, buildPreview, type AnchorablePayment } from './anchor';
import { createHash } from 'node:crypto';

function tx(n: number): string {
  return createHash('sha256').update(String(n)).digest('hex');
}

function payment(n: number): AnchorablePayment {
  return {
    tx_hash: tx(n),
    ledger: 100 + n,
    payer: 'GABC',
    amount: '1',
    asset: 'native',
    ts: '2026-08-01T00:00:00.000Z',
  };
}

describe('recordAnchoredBatch', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('is a no-op when the same selection is already recorded under this batch_id', async () => {
    const preview = buildPreview([payment(1)]);
    query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            selection_hash: preview.selectionHash,
            batch_id: '7',
            root: preview.root,
            status: 'recorded',
            proofs: preview.proofs,
          },
        ],
      })
      .mockResolvedValueOnce({}); // COMMIT

    const result = await recordAnchoredBatch(client as never, {
      selectionHash: preview.selectionHash,
      batchId: 7,
      anchorTx: tx(99),
      root: preview.root,
    });

    expect(result).toEqual({ batchId: 7, alreadyRecorded: true, status: 'recorded' });
    const sql = query.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /UPDATE payments/.test(s))).toBe(false);
  });

  it('marks submitted then recorded, writing proofs onto each payment', async () => {
    const preview = buildPreview([payment(1), payment(2)]);
    query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      if (sql.includes('FROM receipt_batches WHERE selection_hash')) {
        return {
          rows: [
            {
              selection_hash: preview.selectionHash,
              batch_id: null,
              root: preview.root,
              status: 'previewed',
              proofs: preview.proofs,
            },
          ],
        };
      }
      if (sql.includes('UPDATE receipt_batches')) return { rowCount: 1 };
      if (sql.includes('UPDATE payments')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await recordAnchoredBatch(client as never, {
      selectionHash: preview.selectionHash,
      batchId: 3,
      anchorTx: tx(99),
      root: preview.root,
    });

    expect(result).toEqual({ batchId: 3, alreadyRecorded: false, status: 'recorded' });
    const updates = query.mock.calls.filter((c) => String(c[0]).includes('UPDATE payments'));
    expect(updates).toHaveLength(2);
  });

  it('rolls back when the supplied root does not match the preview', async () => {
    const preview = buildPreview([payment(1)]);
    query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
      return {
        rows: [
          {
            selection_hash: preview.selectionHash,
            batch_id: null,
            root: preview.root,
            status: 'previewed',
            proofs: preview.proofs,
          },
        ],
      };
    });

    await expect(
      recordAnchoredBatch(client as never, {
        selectionHash: preview.selectionHash,
        batchId: 3,
        anchorTx: tx(99),
        root: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'ROOT_MISMATCH' });

    expect(query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(true);
  });
});
