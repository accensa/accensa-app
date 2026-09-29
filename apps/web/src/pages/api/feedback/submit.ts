import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transactionId, merchantId, rating, feedbackText, deviceType } = req.body;

    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid rating' });
    }

    // In a real implementation, this would save to a database or analytics service
    // e.g., Mixpanel, PostHog, or a custom Postgres table
    console.log('[Telemetry] Feedback Received:', {
      transactionId,
      merchantId,
      rating,
      feedbackText,
      deviceType,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
