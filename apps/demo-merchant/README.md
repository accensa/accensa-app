# Accensa Demo Merchant

A working example of the seller side of Accensa: an x402 payment-gated Express
server that reports route attribution to an Accensa deployment, plus the buyer
side in [`agent.js`](agent.js) so a reviewer can watch the whole protocol from
both ends.

## Routes

| Route                 | Price      | Demonstrates                                                                            |
| --------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `/api/hello`          | 0.0001 XLM | Cheap, frequent call — the everyday payment                                             |
| `/api/insights/daily` | 0.0025 XLM | A mid price, different in magnitude from `/api/hello`                                   |
| `/api/analytics/full` | 0.1 XLM    | Expensive, rare call — a third, much larger price                                       |
| `/api/free`           | free       | The free/paid boundary: not in the x402 route config, so the middleware lets it through |

Amounts are priced in stroops (1 XLM = 10,000,000 stroops) against the native
XLM Stellar Asset Contract on testnet. The prices are deliberately far apart so
the dashboard's per-route revenue attribution — grouping, sorting, filtering,
per-route totals, and the CSV export's stroop decimal handling — is exercised
against genuinely different numbers, not one value repeated.

`/api/free` is the only route **not** configured in `routesConfig`: the x402
middleware intercepts only configured routes, so this one answers without any
payment handshake.

## What each file is for

- `server.js` — the seller. x402 middleware in front of three priced routes,
  an SSE stream, and a webhook listener for the Accensa indexer.
- `lib/x402-payer.js` — the stock x402 client wired up (official
  `x402Client`/`x402HTTPClient` + the Stellar `ExactStellarScheme`); shared by
  the agent and driver scripts.
- `agent.js` — the buyer. Pays a route end to end (402 → sign → retry →
  resource → settlement), prints every protocol step, and ends by printing a
  receipt in the form the dashboard's `/verify` page accepts.
- `drive.js` — pays a realistic mix across every route in one command, so
  anyone can populate a dashboard with plausible per-route data.

## Prerequisites

- Node.js 20+.
- A **funded testnet payer**: a Stellar testnet account with XLM. Its secret
  key goes in `STELLAR_PRIVATE_KEY` (see below).
- The demo merchant needs `MERCHANT_ADDRESS` set to the address that should
  receive the paid XLM — otherwise it falls back to a placeholder address that
  cannot be paid.

## Funding a testnet payer, start to finish

1. **Create a keypair.** The fastest way is Stellar Lab:
   <https://lab.stellar.org/account/create>. Save the **secret key** (`S...`)
   and the **public address** (`G...`). You only need the secret key for the
   scripts; the public address is handy for checking your balance.
2. **Fund it with testnet XLM.** Open
   <https://lab.stellar.org/account/fund>, paste the public address, and click
   "Get testnet XLM". The Stellar friendbot funds the account immediately; a
   few hundred testnet XLM is more than enough for every demo here.
3. **Put the secret key in an `.env` file** in this directory:

   ```env
   STELLAR_PRIVATE_KEY=S...
   MERCHANT_URL=http://localhost:3001
   # STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   ```

   `dotenv` is already a dependency, so both scripts pick this up. Never commit
   a real secret key.

4. **Verify the account is funded** (optional): paste the public address into
   the Stellar testnet explorer, or run `node agent.js` and check it gets past
   the signing step.

That is the whole setup — no trustlines are needed because the demo prices are
paid in native XLM.

## Running the seller

```bash
MERCHANT_ADDRESS=G... node server.js
```

The server listens on port 3001 (override with `PORT`). Point `ACCENSA_URL` at
your Accensa deployment if you want the merchant to report route attribution;
`HOOK_API_KEY` and `WEBHOOK_SECRET` are required for the dashboard to accept
reports and for the merchant to accept indexer webhooks (see the root README).

## Paying as the agent (buyer side)

With the merchant running, open a second terminal:

```bash
node agent.js
```

This pays `/api/hello` and `/api/insights/daily` (override with `ROUTES`), and
prints:

1. The initial `GET` and the `402 Payment Required` response.
2. The payment option(s) the server declared.
3. The signed payment payload the stock client built.
4. The retry with the payment header.
5. The settlement: success and the on-chain transaction hash.
6. A receipt in the form `/verify` accepts — `batchId`, `leaf`, and `proof` —
   built over the payments this run actually made.

Paste those three values into the dashboard's `/verify` page. The local Merkle
check recomputes the batch root from the proof; the on-chain check needs the
batch to be anchored, which is tracked separately (accensa-app issue #15).

## Populating the dashboard in one command

```bash
node drive.js
```

This makes a realistic mix of calls — five cheap, two mid, one expensive, and
three free — so the dashboard's route column shows several distinct values and
per-route totals differ.

## Relationship to the facilitator's examples

The [x402-facilitator-stellar](https://github.com/accensa/x402-facilitator-stellar)
repository contains two examples:

- `examples/http-seller` — a minimal, focused seller that shows the smallest
  possible x402 integration.
- `examples/mcp-agent` — a minimal buyer agent that pays for resources.

Both are deliberately minimal: they demonstrate the protocol in isolation. This
demo-merchant is the third example and the most complete one. It shows the
**full merchant path** — an x402 Express seller using `ExactStellarScheme`,
with route attribution reporting to an Accensa deployment, a webhook listener
for real-time updates, and an SSE stream for a live frontend. The agent and
driver scripts show the buyer side end to end.

A reviewer evaluating the SCF RFP §5 adoption-strategy criterion should see:

1. The facilitator's examples prove the protocol works in isolation.
2. This demo-merchant proves the protocol works in a realistic merchant
   context — agent pays, facilitator settles, indexer attributes, merchant
   sees revenue.

## Local-only requirements

- The `MERCHANT_ADDRESS` must be set to a real Stellar address before starting
  the server. Without it, the routes use a placeholder address that cannot
  receive payments.
- Webhook signature verification (`WEBHOOK_SECRET`) is optional for local
  development. When unset, all signatures are accepted. In production, set
  this to match the Accensa deployment's `WEBHOOK_SECRET`.
- The `HOOK_API_KEY` is required for route attribution to be reported to
  Accensa. Without it, settlements succeed but attribution is not recorded.

## Notes

- The demo intentionally has **no product, cart, or order model**: it exists to
  exercise x402 route attribution, not to become a store.
- There is **no mock or simulated login** anywhere in this app — real SEP-10
  wallet authentication guards the dashboard, and nothing here touches it.
