import { HttpError } from '../retry';
import { AccensaAuthError, AccensaError, AccensaNetworkError } from './errors';

/** Path the Accensa app exposes for merchant-reported route attribution. */
export const SETTLE_ENDPOINT = '/api/hook/settle';

/** The full settle URL for an indexer base URL, tolerating a trailing slash. */
export function settleEndpointUrl(indexerUrl: string): string {
  return `${indexerUrl.replace(/\/$/, '')}${SETTLE_ENDPOINT}`;
}

/**
 * Classifies a failed settlement report into the SDK error a caller branches on.
 *
 * A 401/403 means the report itself was rejected, not that the network is down,
 * so it becomes an {@link AccensaAuthError}; any other HTTP status is a plain
 * {@link AccensaError}. Everything else — a dropped connection, a timeout
 * (surfacing as an AbortError), or a network failure that exhausted its
 * retries — is an {@link AccensaNetworkError} carrying the underlying message.
 */
export function toSettleReportError(error: unknown, txHash: string, url: string): AccensaError {
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
