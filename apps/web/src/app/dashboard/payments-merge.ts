export interface Payment {
  tx_hash: string;
  ledger: number | null;
  payer: string;
  amount: string;
  asset: string | null;
  ts: string;
  route: string | null;
  method: string | null;
  risk_score?: number;
  risk_country_code?: string;
  requires_manual_review?: boolean;
}

/**
 * Merges the polled head page with any older pages the merchant has scrolled
 * in, newest first, de-duplicated by `tx_hash`.
 */
export function mergePayments(head: Payment[], older: Payment[]): Payment[] {
  const seen = new Set<string>();
  const out: Payment[] = [];
  for (const payment of [...head, ...older]) {
    if (seen.has(payment.tx_hash)) continue;
    seen.add(payment.tx_hash);
    out.push(payment);
  }
  return out;
}
