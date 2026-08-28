/**
 * Strict types for an Accensa product.
 *
 * A product is one of a merchant's sellable x402 endpoints. The indexer does not
 * hold the merchant's price configuration — that lives in the seller's own
 * `routesConfig` — so what it can publish (and what the SDK fetches) is the
 * endpoint identity plus the aggregated revenue the ledger actually shows:
 * how many times the product was paid for and for how much, within a reporting
 * window.
 *
 * As with {@link Order}, optional columns are declared `?` and mapped from SQL
 * `NULL` to `undefined`, so consumers get strict null checks rather than a
 * `Record<string, unknown>`.
 */

/** Free-form metadata a deployment may attach to a product. Strictly optional. */
export type ProductMetadata = Record<string, unknown>;

export interface Product {
  /** The paid endpoint this product represents (e.g. `/api/hello`). */
  id: string;
  /** HTTP method attributed to the endpoint. Absent when never reported. */
  method?: string;
  /** How many times the product was purchased within the reporting window. */
  calls: number;
  /** Total revenue within the window, as a decimal string — never a float. */
  totalRevenue: string;
  /** Optional deployment-supplied metadata. `null` on the wire maps to `undefined`. */
  metadata?: ProductMetadata;
}
