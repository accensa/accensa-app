/**
 * Generic fetch retry wrapper with exponential backoff (#123).
 *
 * `@accensa/sdk` reports settlements to the merchant's indexer over HTTP, and
 * the same shape of problem — a transient 5xx or a dropped connection should
 * not be treated the same as a request that is simply wrong — applies to any
 * Horizon or Soroban RPC call a consumer of this SDK makes. This is exported
 * standalone so it isn't tied to any one call site.
 */

/** Thrown for a non-2xx response. Carries the response so a caller can inspect it. */
export class HttpError extends Error {
  readonly status: number;
  readonly response: Response;

  constructor(response: Response) {
    super(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    this.name = 'HttpError';
    this.status = response.status;
    this.response = response;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 5xx is the conventional "the server, not the request, is the problem" range. */
function isRetryableStatusDefault(status: number): boolean {
  return status >= 500 && status <= 599;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Retry attempts after the first try. Defaults to 3. */
  maxRetries?: number;
  /** Delay before the first retry, doubling each time after. Defaults to 200ms. */
  baseDelayMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Which HTTP status codes are worth retrying. Defaults to 500-599. */
  isRetryableStatus?: (status: number) => boolean;
  /** Called before each retry's delay, e.g. for logging. Never called for the final failure. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Fetches `url`, retrying a 5xx response or a network-level failure (a
 * dropped connection, DNS failure, etc.) with exponential backoff.
 *
 * Two things are deliberately never retried, because trying again cannot
 * change the outcome: a 4xx response means the request itself is wrong, and
 * an `AbortError` means the caller already decided to stop waiting — retrying
 * either would just fail the same way again, or defeat a timeout the caller
 * set on purpose.
 *
 * The returned promise resolves only to a 2xx response; every other outcome
 * throws (`HttpError` for a non-retryable or exhausted-retries HTTP status,
 * or the underlying error for an exhausted-retries network failure).
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 200,
    fetchImpl = fetch,
    isRetryableStatus = isRetryableStatusDefault,
    onRetry,
  } = options;

  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    let networkError: unknown;

    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      networkError = error;
    }

    if (response) {
      if (response.ok) return response;
      if (!isRetryableStatus(response.status)) throw new HttpError(response);
    }

    const error = response ? new HttpError(response) : networkError;
    if (attempt >= maxRetries) throw error;

    const delayMs = baseDelayMs * 2 ** attempt;
    onRetry?.(attempt + 1, error, delayMs);
    await delay(delayMs);
  }
}
