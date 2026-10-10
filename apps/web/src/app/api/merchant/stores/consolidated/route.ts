import { NextResponse } from 'next/server';
import { ensureSchema, withClient, withMerchantClient } from '@/lib/db';
import { getMerchantByAddress } from '@/lib/merchants';
import { sumDecimalStrings } from './sum-decimal-strings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is unavailable' }, { status: 503 });
  }
  const organizationAddress =
    request.headers.get('x-accensa-org-merchant') ?? request.headers.get('x-accensa-merchant');
  if (!organizationAddress) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const organization = await withClient((client) =>
      getMerchantByAddress(client, organizationAddress),
    );
    if (!organization) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const stores = await withMerchantClient(organization.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query<{ id: number; name: string; merchant_id: number }>(
        `SELECT s.id, s.name, s.store_merchant_id AS merchant_id
         FROM merchant_stores s WHERE s.organization_merchant_id = $1 ORDER BY s.name, s.id`,
        [organization.id],
      );
      return result.rows;
    });

    const reports = await Promise.all(
      stores.map(async (store) => {
        const assets = await withMerchantClient(store.merchant_id, async (client) => {
          const result = await client.query<{
            asset: string;
            payment_count: string;
            volume: string;
          }>(
            `SELECT COALESCE(asset, 'native') AS asset, count(*)::text AS payment_count,
                    COALESCE(sum(amount), 0)::text AS volume
             FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL
             GROUP BY COALESCE(asset, 'native') ORDER BY asset`,
            [store.merchant_id],
          );
          return result.rows;
        });
        return {
          storeId: store.id,
          name: store.name,
          paymentCount: assets.reduce((sum, asset) => sum + Number(asset.payment_count), 0),
          assets: assets.map((asset) => ({ asset: asset.asset, volume: asset.volume })),
        };
      }),
    );
    const totalsByAsset = new Map<string, string[]>();
    for (const store of reports) {
      for (const asset of store.assets) {
        const amounts = totalsByAsset.get(asset.asset) ?? [];
        amounts.push(asset.volume);
        totalsByAsset.set(asset.asset, amounts);
      }
    }
    return NextResponse.json({
      stores: reports,
      totals: {
        paymentCount: reports.reduce((sum, store) => sum + store.paymentCount, 0),
        assets: [...totalsByAsset].map(([asset, amounts]) => ({
          asset,
          volume: sumDecimalStrings(amounts),
        })),
      },
    });
  } catch (error) {
    console.error('Unable to aggregate store reporting:', error);
    return NextResponse.json({ error: 'Unable to load consolidated reporting' }, { status: 500 });
  }
}
