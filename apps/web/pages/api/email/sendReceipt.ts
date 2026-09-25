import { NextApiRequest, NextApiResponse } from 'next';
import { sendReceiptEmail } from '../../../lib/email';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, txHash, merchantName, amount, date } = req.body;

  try {
    await sendReceiptEmail(to, { txHash, merchantName, amount, date });
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
