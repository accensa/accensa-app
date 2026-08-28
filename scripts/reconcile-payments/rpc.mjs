// Minimal, standalone Soroban RPC client.
//
// Independent of apps/web/src/app/api/sync's RPC plumbing (rpc(), sweepLedgerRange
// in event-pager.ts) by design - see README.md. This talks to the same public
// JSON-RPC endpoint anyone can reach, nothing internal.

/** One JSON-RPC call, with capped exponential-backoff retry on failure. */
export async function rpcCall(rpcUrl, method, params, { maxAttempts = 3, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`RPC ${method}: ${body.error.message ?? 'unknown error'}`);
      return body.result;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 200));
      }
    }
  }
  throw lastError;
}

/**
 * Ledgers scanned by one `getEvents` window.
 *
 * Soroban RPC bounds how much history a single call will scan and answers an
 * over-large range with either an empty page or a processing-limit error,
 * rather than the requested data - so this walks the chain in bounded chunks
 * rather than requesting one huge range.
 */
export const LEDGER_WINDOW = 10_000;

/**
 * Fetches every raw event addressed to `merchant` across `[fromLedger, toLedger]`
 * from the given asset contracts, paging both across `getEvents` cursors and
 * across ledger windows.
 *
 * @returns {Promise<object[]>} raw events, in ledger order
 */
export async function fetchTransferEvents(
  { rpcUrl, merchant, assetContractIds, fromLedger, toLedger },
  { fetchImpl, onProgress } = {},
) {
  const { xdr, Address } = await import('@stellar/stellar-sdk');
  const transferTopic = xdr.ScVal.scvSymbol('transfer').toXDR('base64');
  const toTopic = new Address(merchant).toScVal().toXDR('base64');
  const filters = [
    {
      type: 'contract',
      contractIds: assetContractIds,
      // The asset topic is optional across protocol versions; match both arities.
      topics: [
        [transferTopic, '*', toTopic, '*'],
        [transferTopic, '*', toTopic],
      ],
    },
  ];

  const events = [];
  for (let windowStart = fromLedger; windowStart <= toLedger; windowStart += LEDGER_WINDOW) {
    const windowEnd = Math.min(windowStart + LEDGER_WINDOW - 1, toLedger);
    let cursor;
    for (;;) {
      const result = await rpcCall(
        rpcUrl,
        'getEvents',
        {
          ...(cursor ? {} : { startLedger: windowStart, endLedger: windowEnd }),
          filters,
          pagination: { limit: 200, ...(cursor ? { cursor } : {}) },
          xdrFormat: 'base64',
        },
        { fetchImpl },
      );
      const page = result.events ?? [];
      events.push(...page);
      if (page.length < 200) break;
      const next = result.cursor ?? page[page.length - 1]?.id;
      if (!next) break;
      cursor = next;
    }
    onProgress?.({ windowStart, windowEnd, toLedger });
  }
  return events;
}

/** Latest closed ledger sequence, per the RPC. */
export async function getLatestLedger(rpcUrl, { fetchImpl } = {}) {
  const result = await rpcCall(rpcUrl, 'getLatestLedger', {}, { fetchImpl });
  return result.sequence;
}
