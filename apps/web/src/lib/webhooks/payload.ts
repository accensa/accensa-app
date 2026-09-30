import { logger } from '../log.ts';
import { WebhookDeliveryError } from './errors.ts';
import type { PaymentPayload } from './types.ts';

export function canonicalPayload(payment: PaymentPayload): string {
  return JSON.stringify({
    tx_hash: payment.tx_hash,
    ledger: payment.ledger,
    payer: payment.payer,
    amount: payment.amount,
    asset: payment.asset,
    ts: payment.ts,
    route: payment.route,
    method: payment.method,
  });
}

export function payloadFromRow(row: Record<string, unknown>): PaymentPayload {
  try {
    const ts = row.ts;
    const payload: PaymentPayload = {
      tx_hash: String(row.tx_hash ?? ''),
      ledger: row.ledger === null || row.ledger === undefined ? null : Number(row.ledger),
      payer: row.payer == null ? null : String(row.payer),
      amount: row.amount == null ? null : String(row.amount),
      asset: row.asset == null ? null : String(row.asset),
      ts: ts instanceof Date ? ts.toISOString() : ts == null ? null : String(ts),
      route: row.route == null ? null : String(row.route),
      method: row.method == null ? null : String(row.method),
    };
    logger.debug('Payload extracted from row', { tx_hash: payload.tx_hash });
    return payload;
  } catch (e) {
    logger.error('Failed to extract payload from row', {
      row,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new WebhookDeliveryError('Failed to extract payload from row', undefined, true);
  }
}
