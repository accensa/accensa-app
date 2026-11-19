// Minimal, standalone Soroban RPC client.
//
// Independent of apps/web/src/app/api/sync's RPC plumbing (rpc(), sweepLedgerRange
// in event-pager.ts) by design - see README.md. This talks to the same public
// JSON-RPC endpoint anyone can reach, nothing internal.

/** Upper bound on how long a server-supplied `Retry-After` can make us wait. */
export const MAX_RETRY_AFTER_MS = 10_000;

/** An RPC failure the server answered with; `retryable` says whether repeating it could help. */
export class RpcError extends Error {
  constructor(message, { status, method, retryable }) {
    super(message);
    this.name = 'RpcError';
    this.status = status;
    this.method = method;
    this.retryable = retryable;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay in ms from a `Retry-After` header (delta-seconds or HTTP date), capped, or undefined. */
function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return undefined;
  let ms = Number(raw) * 1000;
  if (Number.isNaN(ms)) ms = Date.parse(raw) - Date.now();
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/**
 * One JSON-RPC call, with capped exponential-backoff retry on transient failure only:
 * HTTP 429, HTTP 5xx and transport errors (fetch rejection, unreadable body). Any other
 * 4xx and any JSON-RPC `error` is permanent and thrown immediately.
 */
export async function rpcCall(
  rpcUrl,
  method,
  params,
  { maxAttempts = 3, fetchImpl = fetch, sleepImpl = defaultSleep } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let delay = 2 ** attempt * 200;
    try {
      const res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable) delay = retryAfterMs(res) ?? delay;
        throw new RpcError(`RPC ${method} failed: HTTP ${res.status}`, {
          status: res.status,
          method,
          retryable,
        });
      }
      const body = await res.json();
      if (body.error) {
        throw new RpcError(`RPC ${method}: ${body.error.message ?? 'unknown error'}`, {
          status: res.status,
          method,
          retryable: false,
        });
      }
      return body.result;
    } catch (error) {
      if (error instanceof RpcError && !error.retryable) throw error;
      lastError = error;
      if (attempt < maxAttempts) await sleepImpl(delay);
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
