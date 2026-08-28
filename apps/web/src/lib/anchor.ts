import { createHash } from 'node:crypto';
import type { Client } from 'pg';
import { buildBatch, receiptLeaf } from '@accensa/sdk';

/**
 * Maximum receipts per batch. Mirrors ReceiptAnchor's on-chain cap. Issue
 * #219 exists to read this from `get_max_batch_size` rather than hard-code
 * it; until that lands, keep the two numbers in lockstep.
 */
export const MAX_BATCH_SIZE = 1000;

export type AnchorStatus = 'previewed' | 'submitted' | 'recorded';

export interface AnchorablePayment {
  tx_hash: string;
  ledger: number;
  payer: string;
  amount: string;
  asset: string | null;
  ts: string;
}

export interface AnchorPreview {
  selectionHash: string;
  root: string;
  count: number;
  periodStart: number;
  periodEnd: number;
  startLedger: number;
  endLedger: number;
  payments: Array<{
    tx_hash: string;
    leaf: string;
    ledger: number;
    ts: string;
    amount: string;
  }>;
  existing: { batchId: number; status: AnchorStatus; anchorTx: string | null } | null;
}

export function selectionHashOf(txHashes: string[]): string {
  return createHash('sha256').update(txHashes.join('\n')).digest('hex');
}

export function unixSeconds(ts: string | Date): number {
  const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (Number.isNaN(ms)) throw new Error(`unparseable timestamp: ${String(ts)}`);
  return Math.floor(ms / 1000);
}

/**
 * Payments that have been confirmed on-chain and not yet committed to a
 * recorded batch. Ledger is the bound, not wall-clock: sequence is monotonic,
 * a merchant's local clock is not, and two payments in the same second still
 * have a total order on (ledger, tx_hash).
 */
export async function loadUnanchored(
  client: Client,
  opts: { fromLedger?: number; toLedger?: number } = {},
): Promise<AnchorablePayment[]> {
  const params: number[] = [];
  let where = `ts IS NOT NULL AND ledger IS NOT NULL AND batch_id IS NULL`;

  if (opts.fromLedger !== undefined) {
    params.push(opts.fromLedger);
    where += ` AND ledger >= $${params.length}`;
  }
  if (opts.toLedger !== undefined) {
    params.push(opts.toLedger);
    where += ` AND ledger <= $${params.length}`;
  }

  const result = await client.query(
    `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts
     FROM payments
     WHERE ${where}
     ORDER BY ledger ASC, tx_hash ASC
     LIMIT ${MAX_BATCH_SIZE}`,
    params,
  );

  return result.rows.map((row) => ({
    tx_hash: row.tx_hash,
    ledger: Number(row.ledger),
    payer: row.payer,
    amount: String(row.amount),
    asset: row.asset,
    ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
  }));
}

export interface BuiltPreview extends Omit<AnchorPreview, 'existing'> {
  proofs: Record<string, { leaf: string; proof: string[] }>;
}

export function buildPreview(payments: AnchorablePayment[]): BuiltPreview {
  if (payments.length === 0) {
    throw new Error('no unanchored payments in this selection');
  }

  const leaves = payments.map((p) => receiptLeaf(p.tx_hash));
  const batch = buildBatch(leaves);
  const txHashes = payments.map((p) => p.tx_hash);

  const periodStart = unixSeconds(payments[0].ts);
  const periodEnd = unixSeconds(payments[payments.length - 1].ts);

  const proofs: Record<string, { leaf: string; proof: string[] }> = {};
  for (const payment of payments) {
    const leaf = receiptLeaf(payment.tx_hash);
    proofs[payment.tx_hash] = { leaf, proof: batch.proofs[leaf] };
  }

  return {
    selectionHash: selectionHashOf(txHashes),
    root: batch.root,
    count: payments.length,
    periodStart,
    periodEnd,
    startLedger: payments[0].ledger,
    endLedger: payments[payments.length - 1].ledger,
    payments: payments.map((p) => ({
      tx_hash: p.tx_hash,
      leaf: receiptLeaf(p.tx_hash),
      ledger: p.ledger,
      ts: p.ts,
      amount: p.amount,
    })),
    proofs,
  };
}

function toPublicPreview(
  preview: BuiltPreview,
  existing: AnchorPreview['existing'],
): AnchorPreview {
  return {
    selectionHash: preview.selectionHash,
    root: preview.root,
    count: preview.count,
    periodStart: preview.periodStart,
    periodEnd: preview.periodEnd,
    startLedger: preview.startLedger,
    endLedger: preview.endLedger,
    payments: preview.payments,
    existing,
  };
}

export async function persistPreview(
  client: Client,
  preview: BuiltPreview,
): Promise<AnchorPreview> {
  const existing = await client.query<{
    batch_id: string | null;
    status: AnchorStatus;
    anchor_tx: string | null;
    root: string;
  }>(`SELECT batch_id, status, anchor_tx, root FROM receipt_batches WHERE selection_hash = $1`, [
    preview.selectionHash,
  ]);

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return toPublicPreview(
      preview,
      row.batch_id
        ? {
            batchId: Number(row.batch_id),
            status: row.status,
            anchorTx: row.anchor_tx,
          }
        : { batchId: 0, status: row.status, anchorTx: row.anchor_tx },
    );
  }

  await client.query(
    `INSERT INTO receipt_batches (
       selection_hash, root, count, period_start, period_end,
       start_ledger, end_ledger, status, proofs
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'previewed', $8::jsonb)
     ON CONFLICT (selection_hash) DO NOTHING`,
    [
      preview.selectionHash,
      preview.root,
      preview.count,
      preview.periodStart,
      preview.periodEnd,
      preview.startLedger,
      preview.endLedger,
      JSON.stringify(preview.proofs),
    ],
  );

  return toPublicPreview(preview, null);
}

export async function recordAnchoredBatch(
  client: Client,
  input: {
    selectionHash: string;
    batchId: number;
    anchorTx: string;
    root: string;
  },
): Promise<{ batchId: number; alreadyRecorded: boolean; status: AnchorStatus }> {
  await client.query('BEGIN');
  try {
    const result = await recordAnchoredBatchTx(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function recordAnchoredBatchTx(
  client: Client,
  input: {
    selectionHash: string;
    batchId: number;
    anchorTx: string;
    root: string;
  },
): Promise<{ batchId: number; alreadyRecorded: boolean; status: AnchorStatus }> {
  const found = await client.query<{
    selection_hash: string;
    batch_id: string | null;
    root: string;
    status: AnchorStatus;
    proofs: Record<string, { leaf: string; proof: string[] }>;
  }>(
    `SELECT selection_hash, batch_id, root, status, proofs
     FROM receipt_batches WHERE selection_hash = $1 FOR UPDATE`,
    [input.selectionHash],
  );

  if (!found.rows.length) {
    throw Object.assign(new Error('unknown selection — preview this batch first'), {
      code: 'UNKNOWN_SELECTION',
    });
  }

  const row = found.rows[0];
  if (row.root !== input.root) {
    throw Object.assign(new Error('root does not match the previewed selection'), {
      code: 'ROOT_MISMATCH',
    });
  }

  if (row.status === 'recorded' && Number(row.batch_id) === input.batchId) {
    return { batchId: input.batchId, alreadyRecorded: true, status: 'recorded' };
  }

  if (row.batch_id && Number(row.batch_id) !== input.batchId) {
    throw Object.assign(new Error(`this selection is already batch #${row.batch_id}`), {
      code: 'ALREADY_ANCHORED',
    });
  }

  await client.query(
    `UPDATE receipt_batches
     SET batch_id = $2, anchor_tx = $3, status = 'submitted', updated_at = now()
     WHERE selection_hash = $1`,
    [input.selectionHash, input.batchId, input.anchorTx],
  );

  const proofs = row.proofs;
  for (const [txHash, { leaf, proof }] of Object.entries(proofs)) {
    const updated = await client.query(
      `UPDATE payments
       SET batch_id = $2, receipt_leaf = $3, receipt_proof = $4::jsonb
       WHERE tx_hash = $1 AND batch_id IS NULL`,
      [txHash, input.batchId, leaf, JSON.stringify(proof)],
    );
    if ((updated.rowCount ?? 0) === 0) {
      const current = await client.query<{ batch_id: string | null }>(
        `SELECT batch_id FROM payments WHERE tx_hash = $1`,
        [txHash],
      );
      const existingId = current.rows[0]?.batch_id;
      if (existingId && Number(existingId) !== input.batchId) {
        throw Object.assign(new Error(`payment ${txHash} is already in batch #${existingId}`), {
          code: 'PAYMENT_ALREADY_ANCHORED',
        });
      }
    }
  }

  await client.query(
    `UPDATE receipt_batches SET status = 'recorded', updated_at = now() WHERE selection_hash = $1`,
    [input.selectionHash],
  );

  return { batchId: input.batchId, alreadyRecorded: false, status: 'recorded' };
}

export async function getProof(
  client: Client,
  txHash: string,
): Promise<{
  txHash: string;
  batchId: number;
  leaf: string;
  proof: string[];
  root: string;
} | null> {
  const result = await client.query<{
    batch_id: string;
    receipt_leaf: string;
    receipt_proof: string[] | string;
    root: string;
  }>(
    `SELECT p.batch_id, p.receipt_leaf, p.receipt_proof, b.root
     FROM payments p
     JOIN receipt_batches b ON b.batch_id = p.batch_id
     WHERE p.tx_hash = $1 AND p.batch_id IS NOT NULL AND b.status = 'recorded'`,
    [txHash],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  const proof = Array.isArray(row.receipt_proof)
    ? row.receipt_proof
    : (JSON.parse(String(row.receipt_proof)) as string[]);
  return {
    txHash,
    batchId: Number(row.batch_id),
    leaf: row.receipt_leaf,
    proof,
    root: row.root,
  };
}
