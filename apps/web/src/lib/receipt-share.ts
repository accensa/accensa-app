import type { Client } from 'pg';

export interface PublicReceiptShare {
  txHash: string;
  merchantAddress: string;
  amount: string;
  asset: string | null;
  batchId: number;
}

/** Returns only ledger-public fields for an already-recorded receipt. */
export async function getPublicReceiptShare(
  client: Client,
  txHash: string,
): Promise<PublicReceiptShare | null> {
  const result = await client.query<{
    tx_hash: string;
    merchant_address: string;
    amount: string;
    asset: string | null;
    batch_id: string;
  }>(
    `SELECT p.tx_hash, m.address AS merchant_address, p.amount::text AS amount, p.asset, b.batch_id
     FROM payments p
     JOIN merchants m ON m.id = p.merchant_id
     JOIN receipt_batches b ON b.batch_id = p.batch_id
     WHERE p.tx_hash = $1 AND p.batch_id IS NOT NULL AND b.status = 'recorded'`,
    [txHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    txHash: row.tx_hash,
    merchantAddress: row.merchant_address,
    amount: row.amount,
    asset: row.asset,
    batchId: Number(row.batch_id),
  };
}

export function createReceiptShareUrl(origin: string, txHash: string): string {
  return new URL(`/receipt/${encodeURIComponent(txHash)}`, origin).toString();
}

export function createSocialShareLinks(
  origin: string,
  txHash: string,
  amount: string,
  asset: string,
) {
  const imageUrl = createReceiptShareUrl(origin, txHash);
  const ogImageUrl = new URL('/api/og/receipt', origin);
  ogImageUrl.searchParams.set('txHash', txHash);
  const text = `Anchored Stellar payment: ${amount} ${asset}`;
  const x = new URL('https://twitter.com/intent/tweet');
  x.searchParams.set('text', text);
  x.searchParams.set('url', imageUrl);
  const warpcast = new URL('https://warpcast.com/~/compose');
  warpcast.searchParams.set('text', text);
  warpcast.searchParams.append('embeds[]', ogImageUrl.toString());
  const bluesky = new URL('https://bsky.app/intent/compose');
  bluesky.searchParams.set('text', `${text} ${imageUrl}`);
  return {
    imageUrl,
    ogImageUrl: ogImageUrl.toString(),
    x: x.toString(),
    warpcast: warpcast.toString(),
    bluesky: bluesky.toString(),
  };
}
