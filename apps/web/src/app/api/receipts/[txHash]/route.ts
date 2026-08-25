import { NextResponse } from 'next/server';
import { withClient, ensureSchema } from '@/lib/db';
import { getProof } from '@/lib/anchor';
import { isHash32 } from '@/lib/receipt-anchor';

export const dynamic = 'force-dynamic';

/**
 * Serves the membership proof for one payment, so `/verify` can be filled
 * from real data rather than the hand-pasted sample.
 *
 * Public on purpose: a proof is not a secret. Anyone holding a `tx_hash`
 * should be able to fetch the leaf and siblings that place it in an
 * anchored batch.
 */
export async function GET(_request: Request, context: { params: Promise<{ txHash: string }> }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }

  const { txHash } = await context.params;
  if (!isHash32(txHash)) {
    return NextResponse.json({ error: 'txHash must be a 32-byte hex hash' }, { status: 400 });
  }

  try {
    const proof = await withClient(async (client) => {
      await ensureSchema(client);
      return getProof(client, txHash.trim().toLowerCase());
    });
    if (!proof) {
      return NextResponse.json({ error: 'No recorded proof for this payment' }, { status: 404 });
    }
    return NextResponse.json(proof);
  } catch (error: unknown) {
    console.error('receipt proof lookup failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
