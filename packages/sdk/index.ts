import type { Request, Response, NextFunction } from 'express';
import {
  SETTLEMENT_HEADER,
  parseSettlementHeader,
  settlementFromResult,
  routeFromResourceUrl,
  type RequestFacts,
  type Settlement,
  type X402SettleResult,
} from './settlement';

export { verifyReceipt, buildBatch, receiptLeaf, type BatchInfo } from './merkle';
export {
  SETTLEMENT_HEADER,
  parseSettlementHeader,
  settlementFromResult,
  routeFromResourceUrl,
  type RequestFacts,
  type Settlement,
  type X402SettleResult,
} from './settlement';

/** Multi-currency price formatting utilities. */
export {
  formatPrice,
  formatPriceCompact,
  assetSymbol,
  toStroops,
  fromStroops,
  TOKENS,
  type TokenMeta,
} from './src/price-formatter';

/**
 * This package deliberately ships no paywall middleware.
 *
 * Gating a route behind x402 is `@x402/express` (or another x402 server
 * binding) talking to a facilitator — not something Accensa reimplements. This
 * SDK's job starts after that: take the settlement the x402 layer reports and
 * attribute it to the route that earned it, via `attachAccensaHook` below.
 * `apps/demo-merchant` shows the two composed.
 *
 * An earlier `withX402` export stood in for the x402 layer by synthesising a
 * settlement — a fabricated transaction hash and payer, reported to the
 * dashboard as though a payment had occurred. It was removed rather than fixed:
 * a mock that writes to the merchant's payment history is precisely what the
 * contract documented at the top of `settlement.ts` forbids.
 */

/** Path the Accensa app exposes for merchant-reported route attribution. */
export const SETTLE_ENDPOINT = '/api/hook/settle';

export interface AccensaHookOptions {
  /** Base URL of your Accensa deployment, e.g. https://accensa-dashboard.vercel.app */
  indexerUrl: string;
  /** Ed25519 private key in hex format to sign the settlement report. */
  privateKeyHex: string;
  /** Abandon a report after this many milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Called when reporting fails, with the payload that could not be delivered.
   * Reporting is best-effort by design — a paid request must not fail because
   * attribution could not be recorded — but failures should be visible rather
   * than swallowed. Defaults to `console.error`.
   */
  onError?: (error: unknown, payload?: SettleHookPayload) => void;
}

/**
 * How long a report may take before it is abandoned, in milliseconds.
 *
 * Reporting happens after the response has already been sent, so a hung socket
 * costs the merchant nothing visible — but it does pin a request object and an
 * open connection for as long as the OS allows, which under load is how a
 * seller's process runs out of sockets. Five seconds is far longer than the
 * endpoint needs and far shorter than the default TCP timeout.
 */
export const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * The body POSTed to `/api/hook/settle`, and the exact bytes that get signed.
 *
 * Snake-cased because it is a wire format, not an in-process value. Declaring
 * it here means a change to either end that the other does not follow is a
 * compile error in this package rather than a 401 or 400 found in production.
 */
export interface SettleHookPayload {
  tx_hash: string;
  route: string;
  method: string;
  request_id?: string;
  payer?: string;
  amount?: string;
  network?: string;
  reported_at?: string;
}

/** Builds the wire body for one settlement. */
export function toSettleHookPayload(settlement: Settlement): SettleHookPayload {
  return {
    tx_hash: settlement.txHash,
    route: settlement.route,
    method: settlement.method,
    request_id: settlement.requestId,
    payer: settlement.payer,
    amount: settlement.amount,
    network: settlement.network,
    reported_at: new Date().toISOString(),
  };
}

/**
 * The request surface the middleware reads.
 *
 * Express's `Request` satisfies it structurally, and so does anything shaped
 * like it — which is why {@link attachAccensaHook} is generic over the request
 * rather than pinned to Express. A caller with a typed `Request<Params, ...>`
 * keeps that type through to its own handlers.
 */
export interface AttributableRequest {
  method?: string;
  path?: string;
  route?: { path?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Reports one settlement to Accensa.
 *
 * Best-effort: resolves false rather than throwing, so a caller in a request
 * path can ignore the result safely.
 */
export async function reportSettlement(
  settlement: Settlement,
  opts: AccensaHookOptions,
): Promise<boolean> {
  const report = opts.onError ?? reportToConsole;
  const body = toSettleHookPayload(settlement);

  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    report(new Error('No fetch implementation available'), body);
    return false;
  }

  // Abort rather than wait forever. `finally` clears the timer on every exit,
  // including the success path, so a resolved report does not hold the process
  // open for the remainder of the window.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const payload = JSON.stringify(body);

    let signatureHex = '';
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      // Node.js environment
      const crypto = await import('node:crypto');
      const keyBuffer = Buffer.from(opts.privateKeyHex, 'hex');
      const privateKey = crypto.createPrivateKey({
        key: Buffer.concat([
          Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS#8 Ed25519 header
          keyBuffer,
        ]),
        format: 'der',
        type: 'pkcs8',
      });
      signatureHex = crypto.sign(null, Buffer.from(payload), privateKey).toString('hex');
    } else {
      // Browser/Edge has no node:crypto. Fail loudly rather than skip signing:
      // an unsigned report is rejected with 401 by the hook anyway, and a
      // silent no-op here would look like a delivered report that never landed.
      throw new Error('Ed25519 signing requires Node.js crypto in this version');
    }

    const response = await doFetch(`${opts.indexerUrl.replace(/\/$/, '')}${SETTLE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signatureHex,
      },
      body: payload,
      signal: controller.signal,
    });

    if (!response.ok) {
      report(new Error(`Accensa returned ${response.status} for ${settlement.txHash}`), body);
      return false;
    }
    return true;
  } catch (error) {
    report(error, body);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Default {@link AccensaHookOptions.onError}: loud enough to find, quiet enough to ignore. */
function reportToConsole(error: unknown, payload?: SettleHookPayload): void {
  console.error('[accensa] could not report settlement', payload?.tx_hash ?? '', error);
}

/**
 * Express middleware that reports route attribution for x402-paid requests.
 *
 * Reads the settlement from the `X-PAYMENT-RESPONSE` header the x402 middleware
 * sets, once the response is complete. Requests that were not paid for carry no
 * such header and are ignored.
 *
 * Mount this *after* your x402 payment middleware, so the header exists by the
 * time the response finishes.
 *
 * If your server uses `@x402/core`'s resource server directly, prefer
 * {@link createSettleHook} — it receives the settle result as ground truth
 * rather than reading it back off the wire.
 */
export interface AccensaMiddlewareOptions<
  Req extends AttributableRequest = Request,
> extends AccensaHookOptions {
  /**
   * Derives what to attribute the payment to.
   *
   * The default reads `req.route.path`, `req.path`, and `x-request-id`, which
   * is right for plain Express. A server whose router exposes its template
   * elsewhere — or one that paywalls several verbs on a path — supplies this
   * instead. Typing the hook with your own request shape gives the callback
   * that type.
   */
  attribute?: (req: Req) => RequestFacts;
}

export function attachAccensaHook<Req extends AttributableRequest = Request>(
  opts: AccensaMiddlewareOptions<Req>,
) {
  const report = opts.onError ?? reportToConsole;

  return function accensaHook(req: Req, res: Response, next: NextFunction) {
    res.on('finish', () => {
      // `attribute` is caller code running on a response that has already been
      // sent. A bug in it must surface through onError, not as an uncaught
      // exception on a 'finish' listener — which Node turns into a process
      // crash by default.
      let facts: RequestFacts;
      try {
        facts = opts.attribute ? opts.attribute(req) : requestFacts(req);
      } catch (error) {
        report(error);
        return;
      }

      const header = res.getHeader(SETTLEMENT_HEADER);
      const settlement = settlementFromResult(
        parseSettlementHeader(typeof header === 'string' ? header : undefined),
        facts,
      );
      if (settlement) void reportSettlement(settlement, opts);
    });

    next();
  };
}

export interface SettleHookOptions extends AccensaHookOptions {
  /**
   * HTTP method to attribute. The x402 payment payload identifies the resource
   * by URL and carries no method, so a server that paywalls more than one verb
   * on the same path must supply this itself. Defaults to GET.
   */
  method?: string;
}

/**
 * Builds an `onAfterSettle` handler for an x402 resource server.
 *
 * This is the preferred integration: the settle result arrives directly from
 * the facilitator, so nothing has to be parsed back out of a response.
 *
 * ```ts
 * resourceServer.onAfterSettle(createSettleHook({ indexerUrl, privateKeyHex }));
 * ```
 */
export function createSettleHook(opts: SettleHookOptions) {
  return async function onAfterSettle(ctx: {
    result: X402SettleResult;
    paymentPayload?: { resource?: { url?: string } };
  }): Promise<void> {
    const settlement = settlementFromResult(ctx.result, {
      route: routeFromResourceUrl(ctx.paymentPayload?.resource?.url),
      method: opts.method ?? 'GET',
    });
    if (settlement) await reportSettlement(settlement, opts);
  };
}

function requestFacts(req: AttributableRequest): RequestFacts {
  const requestId = req.headers?.['x-request-id'];
  return {
    route: req.route?.path ?? req.path ?? '',
    method: req.method ?? '',
    requestId: Array.isArray(requestId) ? requestId[0] : requestId,
  };
}
