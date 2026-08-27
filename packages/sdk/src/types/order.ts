/**
 * Strict types for an Accensa order.
 *
 * An order is one indexed payment for a merchant's product — a single settled
 * Stellar Asset Contract transfer that the indexer decoded from Soroban `transfer`
 * XDR and recorded in the merchant's payment ledger. The SDK's order fetchers
 * (`AccensaClient.listOrders` / `fetchOrder`) map the indexer's wire rows into
 * this shape, so consumers never see `Record<string, unknown>`.
 *
 * Every column that can be absent on the wire is declared optional (`?`), and
 * the mappers normalise SQL `NULL` to `undefined` — `metadata` is `undefined`
 * unless the deployment actually publishes it, never `null` and never `any`.
 */

/** Free-form metadata a deployment may attach to an order. Strictly optional. */
export type OrderMetadata = Record<string, unknown>;

export interface Order {
  /** The Stellar transaction hash that paid for this order. */
  id: string;
  /**
   * The product purchased — the paid route (e.g. `/api/hello`).
   * Absent until the merchant reports route attribution for the transfer.
   */
  productId?: string;
  /**
   * Amount paid, as a decimal string. Money crosses this boundary as a string,
   * never a float, matching the NUMERIC column the indexer writes.
   */
  amount: string;
  /** The asset that settled (Stellar Asset Contract id, e.g. the native XLM SAC). */
  asset?: string;
  /** Stellar address of the payer. */
  payer?: string;
  /** HTTP method of the paid request. */
  method?: string;
  /** Ledger sequence the transfer was observed on. */
  ledger?: number;
  /** ISO-8601 timestamp of the payment. */
  createdAt: string;
  /** Optional deployment-supplied metadata. `null` on the wire maps to `undefined`. */
  metadata?: OrderMetadata;
}
