/**
 * Outbound payment webhooks — public surface.
 *
 * Delivery is deliberately not part of indexing. The indexer inserts a
 * `webhook_deliveries` row in the same transaction as the payment; a separate
 * path (`/api/webhooks/deliver`) ships the payload. A host that sleeps, 500s,
 * or rate-limits cannot stall the ledger cursor.
 *
 * Issue #350 split the original 570-line module into focused units under
 * `./webhooks/`; this file re-exports them unchanged so every existing
 * import path (`@/lib/webhooks`, `./webhooks`) keeps working:
 *
 *   - `constants.ts`  tuning knobs (attempts, window, timeouts, backoff cap)
 *   - `types.ts`      shared shapes (payload, status, attempt result)
 *   - `errors.ts`     WebhookSigningError / WebhookDeliveryError
 *   - `retry-policy.ts` shouldRetry, Retry-After parsing, backoff, next-attempt clock
 *   - `payload.ts`    canonical serialization and row → payload mapping
 *   - `signing.ts`    Ed25519 body signing and body digests
 *   - `repository.ts` every SQL statement against webhook_deliveries/attempts
 *   - `transport.ts`  one signed HTTP attempt, timeout-safe
 *   - `delivery.ts`   deliverDue orchestration and attempt bookkeeping
 *   - `summary.ts`    the operator-facing status rollup
 */

export { WebhookDeliveryError, WebhookSigningError } from './webhooks/errors.ts';
export {
  ATTEMPT_TIMEOUT_MS,
  DELIVERY_WINDOW_MS,
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
} from './webhooks/constants.ts';
export type { AttemptResult, DeliveryStatus, PaymentPayload } from './webhooks/types.ts';
export { backoffMs, nextRetryAt, parseRetryAfter, shouldRetry } from './webhooks/retry-policy.ts';
export { canonicalPayload, payloadFromRow } from './webhooks/payload.ts';
export { bodyDigest, signBody } from './webhooks/signing.ts';
export { enqueueWebhookDelivery, pendingDue } from './webhooks/repository.ts';
export { deliverDue } from './webhooks/delivery.ts';
export { webhookSummary } from './webhooks/summary.ts';
