/**
 * A real-time indexer update delivered over the SSE stream at `/api/sync/stream`.
 *
 * Mirrors the `SyncEventPayload` shape the sync route broadcasts after each
 * completed run for the subscribing merchant.
 */
export interface SyncEvent {
  /** Merchant Stellar address this run indexed. */
  merchant: string;
  /** Ledger sequence the sweep advanced to (inclusive). */
  syncedTo: number;
  /** Number of payment rows inserted by this run. */
  inserted: number;
  /** Number of event pages scanned. */
  scanned: number;
  /** Number of ledger windows processed. */
  pages: number;
  /** True when the sweep reached the chain head. */
  drained: boolean;
  /** ISO-8601 timestamp of the run's completion. */
  occurredAt: string;
}
