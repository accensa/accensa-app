import { Request, Response, NextFunction } from 'express';

export interface AccensaHookOptions {
  indexerUrl: string;
  apiKey: string;
}

export function attachAccensaHook(opts: AccensaHookOptions) {
  return function(req: Request, res: Response, next: NextFunction) {
    // Intercept the response to capture settlement details
    const originalSend = res.send;
    
    res.send = function (body) {
      res.send = originalSend;
      
      // Assume the x402 middleware sets settlement details in the body or headers
      // For this scaffold, we'll try to extract them from a JSON body or mock them
      try {
        let txHash = "";
        let price = "0";
        
        if (typeof body === 'string') {
          const parsed = JSON.parse(body);
          txHash = parsed.tx_hash || "mock_hash_" + Date.now();
          price = parsed.amount || "0";
        }

        if (txHash) {
          fetch(`${opts.indexerUrl}/hook/settle`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${opts.apiKey}`
            },
            body: JSON.stringify({
              tx_hash: txHash,
              route: req.path,
              method: req.method,
              price: price,
              request_id: req.headers['x-request-id'] || 'unknown'
            })
          }).catch(console.error);
        }
      } catch (e) {
        // Silently ignore if we can't parse the response
      }

      return res.send(body);
    };
    
    next();
  };
}
