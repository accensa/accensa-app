import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { recordAnchoredBatch } from '@/lib/anchor';
import { getBatch, isHash32 } from '@/lib/receipt-anchor';

export const dynamic = 'force-dynamic';

/**
 * Persists the payment-to-batch mapping after `anchor_batch` confirms on
 * chain. The on-chain root is re-read and compared to the previewed tree so
 * a client cannot record proofs against a batch they did not actually
 * submit. Replaying the same selection is a no-op and returns the existing
 * batch_id — that is the double-submit path.
 *
 * If this handler fails after the transaction is in the ledger, the row
 * stays `submitted` (or `previewed` if we never got that far). Calling again
 * with the same body completes the write. That gap is where real money and
 * real confusion live; it is recoverable, and it is tested.
 */
export async function POST(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const rec = body as Record<string, unknown>;
  const selectionHash = typeof rec.selectionHash === 'string' ? rec.selectionHash.trim() : '';
  const root = typeof rec.root === 'string' ? rec.root.trim() : '';
  const anchorTx = typeof rec.anchorTx === 'string' ? rec.anchorTx.trim() : '';
  const batchId = typeof rec.batchId === 'number' ? rec.batchId : Number(rec.batchId);

  if (!isHash32(selectionHash)) {
    return NextResponse.json(
      { error: 'selectionHash must be a 32-byte hex hash' },
      { status: 400 },
    );
  }
  if (!isHash32(root)) {
    return NextResponse.json({ error: 'root must be a 32-byte hex hash' }, { status: 400 });
  }
  if (!isHash32(anchorTx)) {
    return NextResponse.json({ error: 'anchorTx must be a 32-byte hex hash' }, { status: 400 });
  }
  if (!Number.isSafeInteger(batchId) || batchId < 1) {
    return NextResponse.json({ error: 'batchId must be a positive integer' }, { status: 400 });
  }

  let onchain;
  try {
    onchain = await getBatch(batchId);
  } catch (error) {
    console.error('get_batch failed while recording an anchor:', error);
    return NextResponse.json(
      {
        error:
          'Could not read the batch from the ledger. The transaction may still be confirming — retry recording without submitting again.',
      },
      { status: 502 },
    );
  }

  if (onchain.root.toLowerCase() !== root.toLowerCase()) {
    return NextResponse.json(
      { error: 'On-chain root does not match the previewed tree; refusing to record' },
      { status: 409 },
    );
  }

  try {
    const result = await withClient(async (client) => {
      await ensureSchema(client);
      return recordAnchoredBatch(client, {
        selectionHash: selectionHash.toLowerCase(),
        batchId,
        anchorTx: anchorTx.toLowerCase(),
        root: root.toLowerCase(),
      });
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (
      code === 'UNKNOWN_SELECTION' ||
      code === 'ROOT_MISMATCH' ||
      code === 'ALREADY_ANCHORED' ||
      code === 'PAYMENT_ALREADY_ANCHORED'
    ) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Conflict' },
        { status: 409 },
      );
    }
    console.error('anchor record failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
