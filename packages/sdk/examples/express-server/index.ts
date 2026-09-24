/**
 * A complete x402 seller that reports route attribution to Accensa.
 *
 * The problem this solves: the ledger records that a payment happened, but a
 * Stellar Asset Contract transfer has no notion of an HTTP path. The mapping
 * from "this transfer" to "this route earned it" exists only here, at
 * settlement, so this is the one place it can be captured.
 *
 * Run it with `pnpm dev` after copying `.env.example` to `.env`.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  paymentMiddlewareFromHTTPServer,
  x402ResourceServer,
  x402HTTPResourceServer,
} from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { createSettleHook, attachAccensaHook } from '@accensa/sdk';
import { EnvError, loadEnv, type ExampleEnv } from './env';

const app = express();

// Everything below reads validated configuration: a missing `.env`, missing
// required variables, or a bad PORT all resolve through `env.ts` — reported as
// one readable block with a clean exit code, never an unhandled stack trace.
const env = loadEnvOrExit();
const PORT = env.port;

const NETWORK = 'stellar:testnet';

/** Asset to price in — defaulted, documented, and validated in env.ts. */
const XLM_SAC = env.tokenAddress;

const accensa = {
  indexerUrl: env.indexerUrl,
  // Reports are authenticated by an Ed25519 signature over the exact body
  // bytes, not a shared bearer token. The Accensa deployment holds the matching
  // public key and rejects anything it cannot verify with 401.
  privateKeyHex: env.privateKeyHex,
};

// ---------------------------------------------------------------------------
// 1. Ordinary authentication, unrelated to payment
// ---------------------------------------------------------------------------

/**
 * A conventional bearer-token guard for the seller's *own* admin surface.
 *
 * Shown here because the ordering matters and is easy to get wrong: this
 * middleware is mounted on the routes it protects, NOT globally. Mounting it
 * app-wide would reject the x402 payment handshake, which arrives without any
 * of your credentials — the agent paying you has no account with you, which is
 * the entire point of x402.
 */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token || token !== env.adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// 2. The x402 resource server
// ---------------------------------------------------------------------------

const resourceServer = new x402ResourceServer([
  new HTTPFacilitatorClient({ url: 'https://www.x402.org/facilitator' }),
]);

// The facilitator settles, but the resource server still needs the scheme
// implementation to build and verify payment requirements locally.
resourceServer.register(NETWORK, new ExactStellarScheme());

// ---------------------------------------------------------------------------
// 3. Attribution — the preferred integration
// ---------------------------------------------------------------------------

/**
 * `createSettleHook` receives the facilitator's settle result directly, so
 * nothing has to be parsed back off the wire. Prefer it whenever you have
 * access to the resource server.
 *
 * It reports nothing when a settlement carries no transaction hash. That is
 * deliberate: a row whose `tx_hash` never appears on chain is worse than a
 * missing row, because it looks like revenue that cannot be verified.
 */
resourceServer.onAfterSettle(
  createSettleHook({
    ...accensa,
    method: 'GET',
    onError: (error, payload) => {
      // Reporting is best-effort — the payment already settled, and a failure
      // here must not surface to the paying agent. Log it; do not throw.
      console.error('[accensa] attribution failed', payload?.tx_hash ?? '', error);
    },
  }),
);

const routesConfig = {
  '/api/hello': {
    accepts: {
      scheme: 'exact',
      price: { asset: XLM_SAC, amount: '1000' }, // 1000 stroops = 0.0001 XLM
      network: NETWORK,
      payTo: env.merchantAddress,
    },
  },
};

app.use(paymentMiddlewareFromHTTPServer(new x402HTTPResourceServer(resourceServer, routesConfig)));

// ---------------------------------------------------------------------------
// 4. Attribution — the fallback integration
// ---------------------------------------------------------------------------

/**
 * If you do not control the resource server — for example the payment
 * middleware is mounted by a framework plugin — `attachAccensaHook` reads the
 * settlement back off the `X-PAYMENT-RESPONSE` response header instead.
 *
 * Mount it *after* the payment middleware, so the header exists by the time
 * the response finishes. Enabling both hooks at once would report each payment
 * twice, so pick one; this line is commented out because the hook above is
 * already active.
 */
// app.use(attachAccensaHook(accensa));
void attachAccensaHook;

// ---------------------------------------------------------------------------
// 5. Routes
// ---------------------------------------------------------------------------

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Payment verified', data: 'Premium content.' });
});

// Free route: no entry in routesConfig, so the payment middleware ignores it.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Seller-owned, credential-protected, and never paywalled.
app.get('/admin/stats', requireAdmin, (_req, res) => {
  res.json({ note: 'Your own metrics live here.' });
});

app.listen(PORT, () => {
  console.log(`x402 seller listening on http://localhost:${PORT}`);
  console.log(`Paid route: GET /api/hello`);
  console.log(`Reporting attribution to ${accensa.indexerUrl}/api/hook/settle`);
});

/**
 * Boots the example, or explains exactly why it cannot, then exits non-zero.
 *
 * The failure modes live in `env.ts`: a missing `.env` (judged on contents),
 * missing required variables reported together, and a bad PORT falling back
 * with a log line. They surface as one readable block instead of an unhandled
 * `Error` thrown from module scope — the previous behaviour, and exactly what
 * made a half-filled `.env` hard to diagnose.
 */
function loadEnvOrExit(): ExampleEnv {
  try {
    return loadEnv();
  } catch (error) {
    console.error(error instanceof EnvError ? `❌ ${error.message}` : error);
    process.exit(1);
  }
}
