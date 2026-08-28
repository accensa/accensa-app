import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { buildPreview, loadUnanchored, persistPreview, MAX_BATCH_SIZE } from '@/lib/anchor';
import { RECEIPT_ANCHOR_ID } from '@/lib/receipt-anchor';
import { Networks } from '@stellar/stellar-sdk';

export const dynamic = 'force-dynamic';

function parseLedger(value: string | null, label: string): number | undefined {
  if (value === null || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a whole number`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`);
  return n;
}

/**
 * Builds the tree a merchant is about to commit to, without touching the
 * wallet. The root, count, and period shown here are the arguments
 * `anchor_batch` will be signed over, so a preview that disagrees with the
 * signing prompt is a bug.
 */
export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  if (!process.env.MERCHANT_ADDRESS) {
    return NextResponse.json({ error: 'MERCHANT_ADDRESS is not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  let fromLedger: number | undefined;
  let toLedger: number | undefined;
  try {
    fromLedger = parseLedger(searchParams.get('fromLedger'), 'fromLedger');
    toLedger = parseLedger(searchParams.get('toLedger'), 'toLedger');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'invalid range' },
      { status: 400 },
    );
  }

  try {
    const body = await withClient(async (client) => {
      await ensureSchema(client);
      const payments = await loadUnanchored(client, { fromLedger, toLedger });
      if (payments.length === 0) {
        return {
          count: 0,
          merchant: process.env.MERCHANT_ADDRESS,
          contractId: RECEIPT_ANCHOR_ID,
          networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
          maxBatchSize: MAX_BATCH_SIZE,
        };
      }
      const preview = await persistPreview(client, buildPreview(payments));
      return {
        ...preview,
        merchant: process.env.MERCHANT_ADDRESS,
        contractId: RECEIPT_ANCHOR_ID,
        networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
        maxBatchSize: MAX_BATCH_SIZE,
      };
    });
    return NextResponse.json(body);
  } catch (error: unknown) {
    console.error('anchor preview failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
