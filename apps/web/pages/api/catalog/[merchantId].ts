import { NextApiRequest, NextApiResponse } from 'next';
import { revalidateCatalog } from '../../../lib/cache/revalidate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { merchantId, revalidate } = req.query;

  if (req.method === 'POST' && revalidate === 'true') {
    // Webhook listener to purge CDN cache upon product price modifications
    const result = await revalidateCatalog(res, merchantId as string);
    if (result.revalidated) {
      return res.status(200).json(result);
    }
    return res.status(500).json(result);
  }

  if (req.method === 'GET') {
    // Configure Edge Caching & Stale-While-Revalidate
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    
    // Ensure pricing and escrow configuration remain non-cached
    // In a real implementation this would fetch from a database. We return mocked safe catalog data.
    const catalogData = {
      merchantId,
      items: [
        { id: 'prod_1', name: 'Premium Widget', description: 'A high quality widget.' },
        { id: 'prod_2', name: 'Basic Widget', description: 'A standard widget.' },
      ]
    };

    return res.status(200).json(catalogData);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
