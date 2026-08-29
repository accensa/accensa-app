/**
 * Error classes thrown by the SDK.
 *
 * Every error the SDK throws extends {@link AccensaError}, so consumers can
 * handle the whole SDK surface with a single `instanceof AccensaError` catch.
 * The subclasses discriminate the failure modes that matter in practice:
 *
 * - {@link AccensaAuthError} — the indexer rejected the credential (401/403).
 * - {@link AccensaRateLimitError} — a rate-limited RPC or indexer node (429).
 * - {@link AccensaNetworkError} — the indexer could not be reached at all.
 * - {@link AccensaContractError} — the indexer (or a receipt) violated the
 *   documented wire contract.
 *
 * Each class carries the metadata that makes it actionable: HTTP status and
 * path for auth failures, the attempted URL and underlying cause for network
 * failures, and the offending row index for contract violations.
 */

/** Options accepted by every SDK error. */
export interface AccensaErrorOptions {
  /** HTTP status code from an indexer response, when the error came over HTTP. */
  status?: number;
  /** Indexer path that failed, e.g. `/api/payments`. */
  path?: string;
  /** The URL that could not be reached, for network failures. */
  url?: string;
  /** The row index in a page that violated the wire contract. */
  index?: number;
  /** The underlying error, e.g. a `fetch` rejection. */
  cause?: unknown;
}

/**
 * Base class for every error the SDK throws.
 *
 * Used directly for indexer responses that fail without being an auth problem
 * or a network problem (e.g. a 500); the subclasses narrow the cases consumers
 * actually branch on.
 */
export class AccensaError extends Error {
  /** HTTP status code from an indexer response, when there was one. */
  readonly status?: number;

  constructor(message: string, options?: AccensaErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AccensaError';
    this.status = options?.status;
  }
}

/** The indexer rejected the request credential (HTTP 401 or 403). */
export class AccensaAuthError extends AccensaError {
  /** The HTTP status code that rejected the request (401 or 403). */
  readonly status: number;
  /** The indexer path that rejected the request, e.g. `/api/payments`. */
  readonly path?: string;

  constructor(message: string, options: { status: number; path?: string; cause?: unknown }) {
    super(message, { status: options.status, path: options.path, cause: options.cause });
    this.name = 'AccensaAuthError';
    this.status = options.status;
    this.path = options.path;
  }
}

/**
 * A rate-limited RPC or indexer node answered HTTP 429 and the retry budget
 * was exhausted (#155).
 *
 * Thrown by the SDK's rate-limit wrapper after it has already waited and
 * retried, so a caller can catch it and tell the user "try again shortly"
 * instead of crashing on a generic error. `retryAfterMs` carries the server's
 * `Retry-After` hint (or the SDK's backoff) so the UI can show a concrete
 * countdown.
 */
export class AccensaRateLimitError extends AccensaError {
  /** Always 429 for this error type. */
  readonly status: number;
  /** The path or RPC method that was rate limited, when known. */
  readonly path?: string;
  /** How long the caller should wait before retrying, in milliseconds. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { path?: string; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { status: 429, path: options.path, cause: options.cause });
    this.name = 'AccensaRateLimitError';
    this.status = 429;
    this.path = options.path;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The client aborted a request because it exceeded the configured timeout (#134). */
export class AccensaTimeoutError extends AccensaError {
  constructor(message: string, options?: { path?: string; cause?: unknown }) {
    super(message, { path: options?.path, cause: options?.cause });
    this.name = 'AccensaTimeoutError';
  }
}

/** The indexer could not be reached: `fetch` failed, timed out, or is missing. */
export class AccensaNetworkError extends AccensaError {
  /** The URL that could not be reached, when one was attempted. */
  readonly url?: string;

  constructor(message: string, options?: { url?: string; cause?: unknown }) {
    super(message, { url: options?.url, cause: options?.cause });
    this.name = 'AccensaNetworkError';
    this.url = options?.url;
  }
}

/**
 * The indexer (or a receipt) violated the documented wire contract: a malformed
 * row, a non-JSON body, or an improperly encoded Merkle hash.
 */
export class AccensaContractError extends AccensaError {
  /** The row index in the page that violated the contract, when known. */
  readonly index?: number;

  constructor(message: string, options?: { index?: number; cause?: unknown }) {
    super(message, { index: options?.index, cause: options?.cause });
    this.name = 'AccensaContractError';
    this.index = options?.index;
  }
}
