import { describe, expect, it } from 'vitest';
import { createSocialShareLinks, getPublicReceiptShare } from './receipt-share';

describe('receipt sharing', () => {
  it('builds X, Warpcast, and Bluesky intents around the public receipt image', () => {
    const links = createSocialShareLinks('https://merchant.example', 'a'.repeat(64), '4.20', 'XLM');
    expect(links.imageUrl).toBe(`https://merchant.example/receipt/${'a'.repeat(64)}`);
    expect(links.ogImageUrl).toBe(
      `https://merchant.example/api/og/receipt?txHash=${'a'.repeat(64)}`,
    );
    expect(links.x).toContain('twitter.com/intent/tweet');
    expect(links.warpcast).toContain('warpcast.com/~/compose');
    expect(links.bluesky).toContain('bsky.app/intent/compose');
    expect(links.imageUrl).not.toContain('payer');
  });

  it('queries only the receipt, merchant address, amount, and asset', async () => {
    let sql = '';
    const client = {
      query: async (statement: string) => {
        sql = statement;
        return {
          rows: [
            {
              tx_hash: 'a'.repeat(64),
              merchant_address: 'G' + 'A'.repeat(55),
              amount: '4.2',
              asset: 'native',
              batch_id: '7',
            },
          ],
        };
      },
    } as never;
    const receipt = await getPublicReceiptShare(client, 'a'.repeat(64));
    expect(receipt?.batchId).toBe(7);
    expect(sql).not.toContain('payer');
    expect(sql).toContain("b.status = 'recorded'");
  });
});
