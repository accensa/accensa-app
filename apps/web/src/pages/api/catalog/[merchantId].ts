import { NextApiRequest, NextApiResponse } from 'next';
import { ensureSchema, withClient, withMerchantClient } from '../../../lib/db';
import { getMerchantByAddress } from '../../../lib/merchants';
import { revalidateCatalog } from '../../../../lib/cache/revalidate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { merchantId, revalidate } = req.query;
  const requestedMerchantId = Number(merchantId);
  if (!Number.isSafeInteger(requestedMerchantId) || requestedMerchantId < 1) {
    return res.status(400).json({ error: 'Invalid merchant id' });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ error: 'Catalog is unavailable' });
  }

  const merchantAddress = req.headers['x-accensa-merchant'];
  const activeAddress = Array.isArray(merchantAddress) ? merchantAddress[0] : merchantAddress;
  const merchant = activeAddress
    ? await withClient((client) => getMerchantByAddress(client, activeAddress))
    : null;
  if (!merchant || merchant.id !== requestedMerchantId) {
    return res.status(403).json({ error: 'Catalog access is limited to the active store' });
  }

  if (req.method === 'POST' && revalidate === 'true') {
    // Webhook listener to purge CDN cache upon product price modifications
    const result = await revalidateCatalog(res, merchantId as string);
    if (result.revalidated) {
      return res.status(200).json(result);
    }
    return res.status(500).json(result);
  }

  if (req.method === 'GET') {
    const items = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query<{
        sku: string;
        name: string;
        description: string;
        price: string | null;
      }>(
        `SELECT sku, name, description, price::text AS price
         FROM merchant_catalog_items WHERE merchant_id = $1 ORDER BY name, sku`,
        [merchant.id],
      );
      return result.rows;
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ merchantId: merchant.id, items });
  }

  if (req.method === 'PUT') {
    const role = req.headers['x-accensa-role'];
    if (role === 'viewer') return res.status(403).json({ error: 'Admin access required' });
    const body = req.body as {
      sku?: unknown;
      name?: unknown;
      description?: unknown;
      price?: unknown;
      remove?: unknown;
    };
    if (typeof body?.sku !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(body.sku)) {
      return res.status(400).json({ error: 'A valid SKU is required' });
    }

    if (body.remove === true) {
      const result = await withMerchantClient(merchant.id, async (client) => {
        await ensureSchema(client);
        return client.query(
          `DELETE FROM merchant_catalog_items WHERE merchant_id = $1 AND sku = $2`,
          [merchant.id, body.sku],
        );
      });
      return res.status(200).json({ removed: result.rowCount === 1 });
    }

    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 160 ||
      (body.description !== undefined && typeof body.description !== 'string') ||
      (typeof body.price === 'number' && (!Number.isFinite(body.price) || body.price < 0)) ||
      (body.price !== undefined && body.price !== null && typeof body.price !== 'number')
    ) {
      return res.status(400).json({ error: 'Invalid catalog item' });
    }
    const name = body.name.trim();
    const item = await withMerchantClient(merchant.id, async (client) => {
      await ensureSchema(client);
      const result = await client.query(
        `INSERT INTO merchant_catalog_items (merchant_id, sku, name, description, price)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (merchant_id, sku) DO UPDATE SET name = EXCLUDED.name,
           description = EXCLUDED.description, price = EXCLUDED.price, updated_at = now()
         RETURNING sku, name, description, price::text AS price`,
        [merchant.id, body.sku, name, body.description ?? '', body.price ?? null],
      );
      return result.rows[0];
    });
    return res.status(200).json({ item });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
