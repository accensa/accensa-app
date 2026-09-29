import { NextApiResponse } from 'next';

/**
 * Revalidates the cache for a specific merchant catalog
 */
export async function revalidateCatalog(res: NextApiResponse, merchantId: string) {
  try {
    await res.revalidate(`/api/catalog/${merchantId}`);
    return { revalidated: true };
  } catch (err) {
    return { revalidated: false, error: 'Error revalidating' };
  }
}
