import { fetchTransferEvents, getLatestLedger } from './rpc.mjs';
import { decodeTransferEvent } from './decode.mjs';

/**
 * Rebuilds the ledger-derived columns of `payments` for one merchant,
 * from Stellar chain data alone.
 *
 * This is the "standalone rebuild" step: it needs nothing but a Soroban RPC
 * endpoint (public) and the merchant's account address (public, since it is
 * how anyone finds their transfers on the ledger in the first place). No
 * database, no repository secret, no access to Accensa's infrastructure.
 *
 * @returns {Promise<{
 *   rows: Map<string, {tx_hash: string, ledger: number, payer: string, amount: string, asset: string, ts: string}>,
 *   fromLedger: number, toLedger: number
 * }>}
 */
export async function rebuildFromChain(
  { rpcUrl, merchant, assetContractIds, fromLedger, toLedger },
  { fetchImpl, onProgress } = {},
) {
  const latest = toLedger ?? (await getLatestLedger(rpcUrl, { fetchImpl }));
  const events = await fetchTransferEvents(
    { rpcUrl, merchant, assetContractIds, fromLedger, toLedger: latest },
    { fetchImpl, onProgress },
  );

  const rows = new Map();
  for (const event of events) {
    const decoded = decodeTransferEvent(event);
    if (!decoded) continue;
    // Defensive: the RPC filter already restricts to this recipient, but a
    // reconciliation tool should not trust the filter to have been applied
    // correctly by the server it is trying to check.
    if (decoded.to !== merchant) continue;

    const existing = rows.get(decoded.txHash);
    // A transfer can, in principle, appear more than once in the event stream
    // (e.g. re-fetched across overlapping windows). Keep first-seen; SAC
    // transfers are keyed 1:1 with their transaction hash for this merchant.
    if (existing) continue;

    rows.set(decoded.txHash, {
      tx_hash: decoded.txHash,
      ledger: decoded.ledger,
      payer: decoded.payer,
      amount: decoded.amount,
      asset: decoded.asset,
      ts: decoded.ledgerClosedAt,
    });
  }

  return { rows, fromLedger, toLedger: latest };
}
