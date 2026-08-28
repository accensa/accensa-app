import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  paymentMiddlewareFromHTTPServer,
  x402ResourceServer,
  x402HTTPResourceServer,
} from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

const app = express();
const PORT = process.env.PORT || 3001;

// Where to report route attribution. Point this at your Accensa deployment.
const ACCENSA_URL = process.env.ACCENSA_URL || 'http://localhost:3000';
const HOOK_API_KEY = process.env.HOOK_API_KEY;

// Shared secret for verifying inbound webhook signatures from Accensa.
// Must match the WEBHOOK_SECRET configured in the Accensa deployment.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const NETWORK = 'stellar:testnet';

// Native XLM Stellar Asset Contract on testnet. Priced as an explicit
// AssetAmount rather than a bare number: the default money parser assumes
// USDC, and the asset has to match what the indexer watches
// (ASSET_CONTRACT_IDS) or the settled transfer is never picked up.
const XLM_SAC =
  process.env.TOKEN_ADDRESS || 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * x402 identifies the paid resource by absolute URL. Attribution wants the path
 * alone — the host is the merchant's own, so grouping revenue by it is noise.
 * Mirrors routeFromResourceUrl() in @accensa/sdk, inlined here because this
 * demo runs as plain ESM with no build step.
 */
function routeFromResourceUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith('/') ? url : '';
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC-SHA256 signature that the Accensa indexer attaches to
 * outbound webhooks. Returns true when:
 *   - WEBHOOK_SECRET is configured, and the signature matches, OR
 *   - WEBHOOK_SECRET is not configured (permissive mode for local dev).
 *
 * Timing-safe comparison prevents side-channel leakage of the expected MAC.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return true;
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) — real-time push to the frontend
// ---------------------------------------------------------------------------

/** Registered SSE clients (one per browser tab). */
const sseClients = new Set();

function addSseClient(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':\n\n'); // comment to flush the connection
  sseClients.add(res);
  return () => sseClients.delete(res);
}

function broadcastEvent(event, data) {
  for (const client of sseClients) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// 1. Create the resource server and point it to the public facilitator
// ---------------------------------------------------------------------------
const resourceServer = new x402ResourceServer([
  new HTTPFacilitatorClient({ url: 'https://www.x402.org/facilitator' }),
]);

// The facilitator settles, but the resource server still needs the scheme
// implementation to build and verify payment requirements locally.
resourceServer.register(NETWORK, new ExactStellarScheme());

// ---------------------------------------------------------------------------
// 2. Path B: report the route that was paid for.
//
// The ledger records the transfer but not the route — a SAC transfer event has
// no notion of an HTTP path. That mapping only exists here, at settlement, so
// this is where it has to be captured.
//
// Note what is *not* here: no fallback hash. If x402 reports a settlement
// without a transaction, there is nothing to attribute and we send nothing. A
// row whose tx_hash never appears on chain is worse than a missing row.
// ---------------------------------------------------------------------------
resourceServer.onAfterSettle(async (ctx) => {
  if (!ctx.result.success) {
    console.error('❌ Settlement failed:', ctx.result.errorReason);
    return;
  }
  if (!ctx.result.transaction) {
    console.warn('⚠️  Settlement succeeded without a transaction hash; nothing to attribute');
    return;
  }
  if (!HOOK_API_KEY) {
    console.warn('⚠️  HOOK_API_KEY is not set; skipping attribution report');
    return;
  }

  // x402 identifies the paid resource by absolute URL; attribution wants the
  // path. There is no method on the payload, so a server paywalling more than
  // one verb on a path has to decide for itself which it is reporting.
  const route = routeFromResourceUrl(ctx.paymentPayload?.resource?.url);
  if (!route) {
    console.warn('⚠️  Settlement carried no resource URL; nothing to attribute');
    return;
  }

  console.log('✅ Settled', ctx.result.transaction, 'for', route);

  try {
    const res = await fetch(`${ACCENSA_URL}/api/hook/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${HOOK_API_KEY}`,
      },
      body: JSON.stringify({
        tx_hash: ctx.result.transaction,
        route,
        method: 'GET',
        payer: ctx.result.payer,
      }),
    });

    if (!res.ok) {
      console.error(`⚠️  Accensa returned ${res.status}:`, await res.text());
    } else {
      console.log('📊 Attribution reported to Accensa');
    }
  } catch (error) {
    // Never let reporting break a paid request — the payment already settled.
    console.error('⚠️  Could not reach Accensa:', error.message);
  }
});

// ---------------------------------------------------------------------------
// 3. Configure the routes
//
// Several priced routes at deliberately different magnitudes, so the dashboard
// has real per-route attribution to show: grouping, sorting and filtering by
// route, per-route totals, and the CSV export's stroop decimal handling all
// get exercised against genuinely different prices. Amounts are in stroops
// (1 XLM = 10,000,000 stroops).
// ---------------------------------------------------------------------------
const routesConfig = {
  // Cheap and frequent — the "everyday" call. 0.0001 XLM.
  '/api/hello': {
    accepts: {
      scheme: 'exact',
      price: { asset: XLM_SAC, amount: '1000' }, // 1000 stroops
      network: NETWORK,
      payTo: process.env.MERCHANT_ADDRESS || 'GAQW...REPLACE_WITH_REAL_ADDRESS',
    },
  },
  // Mid price — 0.0025 XLM. A different magnitude from /api/hello so per-route
  // totals differ by more than call count.
  '/api/insights/daily': {
    accepts: {
      scheme: 'exact',
      price: { asset: XLM_SAC, amount: '25000' }, // 25,000 stroops
      network: NETWORK,
      payTo: process.env.MERCHANT_ADDRESS || 'GAQW...REPLACE_WITH_REAL_ADDRESS',
    },
  },
  // Expensive and rare — 0.1 XLM. A third, much larger magnitude so decimal
  // handling and totals are exercised at a genuinely different scale.
  '/api/analytics/full': {
    accepts: {
      scheme: 'exact',
      price: { asset: XLM_SAC, amount: '1000000' }, // 1,000,000 stroops
      network: NETWORK,
      payTo: process.env.MERCHANT_ADDRESS || 'GAQW...REPLACE_WITH_REAL_ADDRESS',
    },
  },
};

// /api/free is deliberately NOT in routesConfig: the x402 middleware only
// intercepts configured routes, so this route passes straight through — the
// free/paid boundary is visible in one server.

const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);

// 4. Apply the x402 payment middleware
app.use(paymentMiddlewareFromHTTPServer(httpServer));

// Parse JSON bodies for the webhook endpoint (skip for x402 payment handshake
// paths which have their own content type).
app.use('/api/webhooks', express.json());

// ---------------------------------------------------------------------------
// 5. Routes — payment-gated
// ---------------------------------------------------------------------------

app.get('/api/hello', (_req, res) => {
  res.json({
    message: 'Payment verified!',
    data: 'This is the premium Accensa content.',
    route: '/api/hello',
    price: '0.0001 XLM',
  });
});

app.get('/api/insights/daily', (_req, res) => {
  res.json({
    message: 'Payment verified!',
    data: 'Your daily insights digest.',
    route: '/api/insights/daily',
    price: '0.0025 XLM',
  });
});

app.get('/api/analytics/full', (_req, res) => {
  res.json({
    message: 'Payment verified!',
    data: 'The full analytics report, exported.',
    route: '/api/analytics/full',
    price: '0.1 XLM',
  });
});

// ---------------------------------------------------------------------------
// 5b. Route — free (no payment required)
// ---------------------------------------------------------------------------

app.get('/api/free', (_req, res) => {
  res.json({
    message: 'No payment needed!',
    data: 'Public content, served without an x402 gate.',
    route: '/api/free',
    price: 'free',
  });
});

// ---------------------------------------------------------------------------
// 6. Routes — inbound webhook from Accensa
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/accensa
 *
 * Receives payment-notifications from the Accensa indexer. The indexer signs
 * the JSON body with HMAC-SHA256 using a shared WEBHOOK_SECRET; the signature
 * arrives in the X-Webhook-Signature header.
 *
 * On success the event is broadcast to all connected SSE clients so the
 * frontend can update in real time.
 */
app.post('/api/webhooks/accensa', (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-webhook-signature'];

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn('⚠️  Webhook signature verification failed — rejecting');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payment = req.body;
  console.log('🔔 Webhook received:', payment.tx_hash ?? payment.id ?? 'unknown');

  // Broadcast to every connected SSE client
  broadcastEvent('payment', {
    type: 'payment',
    txHash: payment.tx_hash,
    ledger: payment.ledger,
    payer: payment.payer,
    amount: payment.amount,
    asset: payment.asset,
    route: payment.route,
    ts: payment.ts,
    receivedAt: new Date().toISOString(),
  });

  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// 7. Routes — SSE stream for the frontend
// ---------------------------------------------------------------------------

/**
 * GET /api/events
 *
 * Server-Sent Events endpoint. The browser opens a persistent connection here
 * and receives real-time updates whenever the Accensa indexer pushes a
 * webhook. The connection stays open until the client disconnects.
 */
app.get('/api/events', (req, res) => {
  const removeClient = addSseClient(res);
  console.log(`📡 SSE client connected (${sseClients.size} total)`);

  req.on('close', () => {
    removeClient();
    console.log(`📡 SSE client disconnected (${sseClients.size} total)`);
  });
});

// ---------------------------------------------------------------------------
// 8. Frontend — minimal demo page
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accensa Demo Merchant</title>
<style>
  :root {
    --bg: #0a0a0a; --surface: #141414; --border: #262626;
    --text: #e5e5e5; --muted: #a3a3a3; --accent: #22c55e;
    --accent-dim: #16a34a;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 640px; margin: 0 auto; padding: 3rem 1.5rem; }
  h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: .25rem; }
  .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: .95rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: .75rem; padding: 1.5rem; margin-bottom: 1.5rem; }
  .card h2 { font-size: 1rem; font-weight: 500; margin-bottom: .75rem; color: var(--muted); }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: .5rem; vertical-align: middle; }
  .status-dot.connected { background: var(--accent); }
  .status-dot.disconnected { background: #ef4444; }
  .pay-btn {
    display: inline-flex; align-items: center; gap: .5rem;
    background: var(--accent); color: #000; border: none; border-radius: .5rem;
    padding: .75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer;
    transition: background .15s;
  }
  .pay-btn:hover { background: var(--accent-dim); }
  .pay-btn:disabled { opacity: .6; cursor: not-allowed; }
  .pay-btn .spinner {
    display: none; width: 1em; height: 1em; flex: none;
    border: 2px solid currentColor; border-right-color: transparent;
    border-radius: 50%; animation: spin .6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .event-list { list-style: none; }
  .event-list li {
    padding: .75rem 0; border-bottom: 1px solid var(--border);
    font-size: .875rem; line-height: 1.5;
  }
  .event-list li:last-child { border-bottom: none; }
  .event-list .tx { font-family: monospace; color: var(--accent); word-break: break-all; }
  .event-list .time { color: var(--muted); font-size: .8rem; }
  .empty { color: var(--muted); font-size: .875rem; }
</style>
</head>
<body>
<div class="container">
  <h1>Accensa Demo Merchant</h1>
  <p class="subtitle">x402 payment-gated endpoint with real-time webhook updates</p>

  <div class="card">
    <h2>Webhook Connection</h2>
    <p id="conn-status">
      <span class="status-dot disconnected" id="dot"></span>
      <span id="conn-text">Connecting&hellip;</span>
    </p>
  </div>

  <div class="card">
    <h2>Paid Endpoints</h2>
    <p style="margin-bottom:1rem;font-size:.875rem;color:var(--muted);">
      Each route costs a different amount, so the dashboard can show per-route
      attribution.
    </p>
    <div style="display:flex;flex-direction:column;gap:.75rem;">
      <button class="pay-btn" id="pay-btn-hello" onclick="callRoute('/api/hello')">
        <span class="spinner" aria-hidden="true"></span><span class="label">Pay &amp; Call /api/hello &mdash; 0.0001 XLM</span>
      </button>
      <button class="pay-btn" id="pay-btn-insights" onclick="callRoute('/api/insights/daily')">
        <span class="spinner" aria-hidden="true"></span><span class="label">Pay &amp; Call /api/insights/daily &mdash; 0.0025 XLM</span>
      </button>
      <button class="pay-btn" id="pay-btn-analytics" onclick="callRoute('/api/analytics/full')">
        <span class="spinner" aria-hidden="true"></span><span class="label">Pay &amp; Call /api/analytics/full &mdash; 0.1 XLM</span>
      </button>
      <button class="pay-btn" id="pay-btn-free" onclick="callRoute('/api/free')" style="background:var(--surface);color:var(--text);border:1px solid var(--border);">
        <span class="spinner" aria-hidden="true"></span><span class="label">Call /api/free &mdash; free</span>
      </button>
    </div>
    <p id="pay-result" style="margin-top:.75rem;font-size:.875rem;"></p>
  </div>

  <div class="card">
    <h2>Payment Events (via SSE)</h2>
    <ul class="event-list" id="events">
      <li class="empty">No events yet. Pay to trigger one.</li>
    </ul>
  </div>
</div>

<script>
const dot = document.getElementById('dot');
const connText = document.getElementById('conn-text');
const eventsList = document.getElementById('events');
const payResult = document.getElementById('pay-result');
let hasEvents = false;

// ---- SSE ----
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    dot.className = 'status-dot connected';
    connText.textContent = 'Connected';
  };
  es.onerror = () => {
    dot.className = 'status-dot disconnected';
    connText.textContent = 'Reconnecting\u2026';
  };
  es.addEventListener('payment', (e) => {
    const data = JSON.parse(e.data);
    addEvent(data);
    showToast(data);
  });
}

function addEvent(data) {
  if (!hasEvents) { eventsList.innerHTML = ''; hasEvents = true; }
  const li = document.createElement('li');
  const ts = data.receivedAt ? new Date(data.receivedAt).toLocaleTimeString() : '';
  const amount = data.amount ? \` (\${data.amount})\` : '';
  li.innerHTML =
    \`<span class="tx">\${data.txHash ?? 'unknown'}</span>\` +
    \`\${amount}<br><span class="time">\${ts}</span>\`;
  eventsList.prepend(li);
}

// ---- Toast ----
function showToast(data) {
  const toast = document.createElement('div');
  toast.textContent = 'Payment Successful!';
  Object.assign(toast.style, {
    position: 'fixed', bottom: '1.5rem', right: '1.5rem',
    background: '#16a34a', color: '#fff', padding: '.75rem 1.25rem',
    borderRadius: '.5rem', fontWeight: '600', fontSize: '.95rem',
    boxShadow: '0 4px 12px rgba(0,0,0,.4)',
    zIndex: '9999', opacity: '0', transition: 'opacity .3s',
  });
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = '1');
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ---- Pay button (calls the x402-gated endpoints, or the free route) ----
// Marks the button as processing (spinner + "Preparing transaction\u2026") the
// moment it is clicked, disables it to prevent double-submits, and resets the
// state in a finally so it always recovers whether the call succeeds or fails.
async function callRoute(route) {
  const id = {
    '/api/hello': 'pay-btn-hello',
    '/api/insights/daily': 'pay-btn-insights',
    '/api/analytics/full': 'pay-btn-analytics',
    '/api/free': 'pay-btn-free',
  }[route];
  const btn = document.getElementById(id);
  const spinner = btn.querySelector('.spinner');
  const label = btn.querySelector('.label');
  const originalLabel = label.textContent;
  // Enter processing state immediately on click.
  btn.disabled = true;
  spinner.style.display = 'inline-block';
  label.textContent = 'Preparing transaction\u2026';
  btn.setAttribute('aria-busy', 'true');
  payResult.textContent = '';
  try {
    const res = await fetch(route);
    const json = await res.json();
    payResult.textContent = JSON.stringify(json);
  } catch (err) {
    payResult.textContent = 'Error: ' + err.message;
  } finally {
    // Reset state whether the call succeeded or failed.
    btn.disabled = false;
    spinner.style.display = 'none';
    label.textContent = originalLabel;
    btn.removeAttribute('aria-busy');
  }
}

connectSSE();
</script>
</body>
</html>`);
});

// ---------------------------------------------------------------------------
// 9. Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Demo merchant server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`Protected routes:`);
  for (const route of Object.keys(routesConfig)) {
    const price = routesConfig[route].accepts.price;
    console.log(`  - http://localhost:${PORT}${route} (${price.amount} stroops)`);
  }
  console.log(`Free route: http://localhost:${PORT}/api/free (no payment)`);
  console.log(`Reporting attribution to: ${ACCENSA_URL}/api/hook/settle`);
  console.log(`Webhook endpoint: POST http://localhost:${PORT}/api/webhooks/accensa`);
  console.log(`SSE stream: GET http://localhost:${PORT}/api/events`);
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️  WEBHOOK_SECRET is not set — webhook signature verification is disabled');
  }
});
