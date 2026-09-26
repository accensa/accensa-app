import { HttpError } from '../retry';
import {
  type SettlementMethod,
  type SettlementReportBody,
  type SettlementReportResultBody,
} from './api';
import {
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
} from './errors';
import type { Settlement } from '../settlement';

/** Path the Accensa app exposes for merchant-reported route attribution. */
export const SETTLE_ENDPOINT = '/api/hook/settle';

/** The full settle URL for an indexer base URL, tolerating a trailing slash. */
export function settleEndpointUrl(indexerUrl: string): string {
  return `${indexerUrl.replace(/\/$/, '')}${SETTLE_ENDPOINT}`;
}

/**
 * The body POSTed to `/api/hook/settle`, and the exact bytes that get signed.
 *
 * Snake_cased because it is a wire format, not an in-process value. It is an
 * alias of the spec's own `SettlementReport` (see `api/operations.ts`), not a
 * hand-written copy: a change to `openapi.yaml` that the SDK does not follow
 * is now a compile error in this package, rather than a 400 or 401 discovered
 * by a merchant in production.
 */
export type SettleHookPayload = SettlementReportBody;

/** What the indexer answers after a report is recorded or staged. */
export type SettleHookResult = SettlementReportResultBody;

/**
 * The HTTP methods `/api/hook/settle` can attribute a payment to.
 *
 * `satisfies` checks every entry against the spec's own enum, and
 * `api-types.test-d.ts` checks the reverse - that the list is exactly as long
 * as the enum - so the runtime list cannot drift in either direction.
 */
export const SETTLE_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const satisfies readonly SettlementMethod[];

/** Narrows an arbitrary string to a method the settle endpoint accepts. */
export function isSettleMethod(method: string): method is SettlementMethod {
  return (SETTLE_METHODS as readonly string[]).includes(method);
}

/**
 * Normalizes a request's method into one the settle endpoint accepts.
 *
 * `Settlement.method` is whatever the caller's server saw, and an
 * `attribute` callback is free to return it verbatim - `req.method` from
 * Express is already uppercase, but a hand-rolled router or a framework with
 * different casing is not. The indexer rejects anything outside the seven
 * methods it documents (`apps/web/src/lib/settlement-report.ts`), so the
 * narrow happens here instead: failing before the bytes are signed names the
 * offending method, where a 400 from the server cannot.
 *
 * @throws {AccensaContractError} for a method outside the spec's enum.
 */
export function toSettleMethod(method: string): SettlementMethod {
  const normalized = method.trim().toUpperCase();
  if (!isSettleMethod(normalized)) {
    throw new AccensaContractError(
      `Cannot report a settlement for ${JSON.stringify(method)}: ${SETTLE_ENDPOINT} accepts only ` +
        `${SETTLE_METHODS.join(', ')}.`,
    );
  }
  return normalized;
}

/** Builds the wire body for one settlement. */
export function toSettleHookPayload(settlement: Settlement): SettleHookPayload {
  return {
    tx_hash: settlement.txHash,
    route: settlement.route,
    method: toSettleMethod(settlement.method),
    request_id: settlement.requestId,
    payer: settlement.payer,
    amount: settlement.amount,
    network: settlement.network,
    reported_at: new Date().toISOString(),
  };
}

/**
 * Classifies a failed settlement report into the SDK error a caller branches on.
 *
 * A 401/403 means the report itself was rejected, not that the network is down,
 * so it becomes an {@link AccensaAuthError}; any other HTTP status is a plain
 * {@link AccensaError}. Everything else — a dropped connection, a timeout
 * (surfacing as an AbortError), or a network failure that exhausted its
 * retries — is an {@link AccensaNetworkError} carrying the underlying message.
 *
 * An error that is already an {@link AccensaError} is passed through
 * unchanged. Building the report can fail before anything is sent (see
 * {@link toSettleMethod}), and reporting that as a *network* failure would
 * send the reader looking at connectivity instead of at the method they
 * attributed the payment to.
 */
export function toSettleReportError(error: unknown, txHash: string, url: string): AccensaError {
  if (error instanceof AccensaError) return error;

  if (error instanceof HttpError) {
    const { status } = error;
    const message = `Accensa returned ${status} for ${txHash}`;
    return status === 401 || status === 403
      ? new AccensaAuthError(message, { status, path: SETTLE_ENDPOINT })
      : new AccensaError(message, { status });
  }

  const causeText = error instanceof Error ? error.message : String(error);
  return new AccensaNetworkError(
    `Failed to reach the Accensa indexer at ${SETTLE_ENDPOINT}: ${causeText}`,
    { url, cause: error },
  );
}
