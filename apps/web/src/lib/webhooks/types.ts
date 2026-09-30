export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead_letter';

export interface PaymentPayload {
  tx_hash: string;
  ledger: number | null;
  payer: string | null;
  amount: string | null;
  asset: string | null;
  ts: string | null;
  route: string | null;
  method: string | null;
}

export interface AttemptResult {
  id: number;
  status: DeliveryStatus;
  statusCode: number | null;
  error: string | null;
}

/** One row of the `webhook_deliveries` table as the delivery path reads it. */
export interface DueDeliveryRow {
  id: string;
  payment_tx_hash: string;
  url: string;
  payload: PaymentPayload;
  attempts: number;
  created_at: Date;
}
