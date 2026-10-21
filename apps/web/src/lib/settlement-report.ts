/**
 * Validation for merchant-reported settlements arriving at /api/hook/settle.
 *
 * Kept separate from the route handler so the rules are unit-testable without a
 * database. Everything here is deliberately strict: this endpoint is the one
 * write path into `payments` that does not originate from the ledger, so a
 * malformed or over-long field must be rejected rather than normalized.
 */

export interface SettlementReport {
  txHash: string;
  route: string;
  method: string;
  requestId: string | null;
  payer: string | null;
  reportedAt: string | null;
}

/**
 * Typed rejection codes for reports that fail the *timestamp window* rather
 * than shape validation.
 *
 * The signature over such a report verifies — the bytes are genuinely the
 * merchant's — but the signed time is not acceptable at this moment. The
 * route maps these to a 401 with the same `code` echoed back, so callers can
 * branch on a stable token instead of matching prose.
 */
export type SettlementWindowCode = 'report_too_old' | 'report_future_dated';

export type ParseResult =
  | { ok: true; report: SettlementReport }
  | { ok: false; error: string; code?: SettlementWindowCode };

/** Stellar transaction hashes are 32 bytes, hex-encoded. */
const TX_HASH = /^[0-9a-f]{64}$/i;

/** Stellar public keys: 56-character base32 starting with G. */
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Column widths in the payments table; over-long input is an error, not a truncation. */
const MAX_ROUTE = 255;
const MAX_REQUEST_ID = 64;

export function parseSettlementReport(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }

  const b = body as Record<string, unknown>;

  const txHash = typeof b.tx_hash === 'string' ? b.tx_hash.trim() : '';
  if (!TX_HASH.test(txHash)) {
    return { ok: false, error: 'tx_hash must be a hex-encoded 32-byte transaction hash' };
  }

  const route = typeof b.route === 'string' ? b.route.trim() : '';
  if (route === '') return { ok: false, error: 'route is required' };
  if (route.length > MAX_ROUTE) {
    return { ok: false, error: `route must be at most ${MAX_ROUTE} characters` };
  }

  const method = typeof b.method === 'string' ? b.method.trim().toUpperCase() : '';
  if (!METHODS.has(method)) {
    return { ok: false, error: 'method must be a standard HTTP method' };
  }

  let requestId: string | null = null;
  if (b.request_id !== undefined && b.request_id !== null) {
    if (typeof b.request_id !== 'string') {
      return { ok: false, error: 'request_id must be a string' };
    }
    const trimmed = b.request_id.trim();
    if (trimmed.length > MAX_REQUEST_ID) {
      return { ok: false, error: `request_id must be at most ${MAX_REQUEST_ID} characters` };
    }
    requestId = trimmed === '' ? null : trimmed;
  }

  // The payer is only ever a hint used to stage a not-yet-indexed payment; the
  // indexer overwrites it with the value read from the ledger. Reject a
  // malformed one rather than persisting a value that can never reconcile.
  let payer: string | null = null;
  if (b.payer !== undefined && b.payer !== null) {
    if (typeof b.payer !== 'string') {
      return { ok: false, error: 'payer must be a string' };
    }
    const trimmed = b.payer.trim();
    if (trimmed !== '' && !ACCOUNT_ID.test(trimmed)) {
      return { ok: false, error: 'payer must be a Stellar account ID' };
    }
    payer = trimmed === '' ? null : trimmed;
  }

  let reportedAt: string | null = null;
  if (b.reported_at !== undefined && b.reported_at !== null) {
    if (typeof b.reported_at !== 'string') {
      return { ok: false, error: 'reported_at must be a string' };
    }
    const d = new Date(b.reported_at);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: 'reported_at must be an ISO-8601 timestamp' };
    }
    // The accepted window is five minutes by default — the exact bound
    // apps/web/src/proxy.ts documents for this endpoint. `reported_at` is
    // inside the signed bytes, so it is the one timestamp a replay cannot
    // refresh: a captured body grows older by the second and leaves this
    // window permanently. `HOOK_MAX_AGE_MS` overrides the age bound for a
    // deployment with genuinely skewed clocks; a non-numeric or non-positive
    // value must not silently disable the window (Number('x') is NaN, and
    // `age > NaN` is never true).
    const envMaxAge = Number(process.env.HOOK_MAX_AGE_MS);
    const maxAgeMs = Number.isFinite(envMaxAge) && envMaxAge > 0 ? envMaxAge : 300000;
    const now = Date.now();
    const age = now - d.getTime();
    if (age > maxAgeMs) {
      return { ok: false, error: 'report_too_old', code: 'report_too_old' };
    }
    // 5 minutes clock skew
    if (d.getTime() > now + 300000) {
      return { ok: false, error: 'report_future_dated', code: 'report_future_dated' };
    }
    reportedAt = b.reported_at;
  } else {
    // transition window
    if (Date.now() > new Date('2027-01-01T00:00:00Z').getTime()) {
      return { ok: false, error: 'reported_at is required' };
    }
  }

  return {
    ok: true,
    report: { txHash: txHash.toLowerCase(), route, method, requestId, payer, reportedAt },
  };
}
