# Express x402 seller with Accensa attribution

A complete, runnable seller: it paywalls `GET /api/hello` with x402, and reports
which route earned each settled payment to Accensa.

## Why this exists

A Stellar Asset Contract transfer records the amount, the payer, and the ledger.
It does not record which HTTP endpoint was bought — there is nowhere in the
transfer for that to live. The only moment the mapping exists is at settlement,
inside your server. That is what the hook captures.

Accensa keeps the two provenances separate: the ledger fields come from the
chain, and `route`/`method` are marked as merchant-reported. Nothing you send
here can overwrite a ledger-owned field.

## Setup

```bash
cp .env.example .env   # then fill it in
pnpm install
pnpm dev
```

### Environment

| Variable                  | Required | What it is                                                                                                                                                      |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCENSA_PRIVATE_KEY_HEX` | **yes**  | Ed25519 private key, hex. Reports are signed with it; your Accensa deployment verifies against the matching public key and rejects anything else with 401.      |
| `MERCHANT_ADDRESS`        | **yes**  | Stellar address that receives payment (`G...`).                                                                                                                 |
| `ACCENSA_URL`             | no       | Your Accensa deployment. Defaults to `http://localhost:3000`.                                                                                                   |
| `TOKEN_ADDRESS`           | no       | Asset contract to price in. Defaults to native XLM's testnet SAC. Must match an asset your Accensa indexer watches, or the settled transfer is never picked up. |
| `ADMIN_TOKEN`             | no       | Bearer token for the example's own `/admin/stats` route. Unrelated to x402.                                                                                     |
| `PORT`                    | no       | Defaults to `3001`.                                                                                                                                             |

`ACCENSA_PRIVATE_KEY_HEX` and `MERCHANT_ADDRESS` are checked at boot, not at settlement
time. A server that takes payments while silently dropping every attribution is
worse than one that refuses to start — the failure would otherwise surface days
later as an empty routes column.

All of the variables above are validated in one pass by `env.ts`: a missing
`.env` is judged on its contents instead of crashing before the example runs,
every missing required variable is listed in a single boot message, and each
optional fallback is logged so nothing degrades silently.

## Trying it

```bash
curl -i localhost:3001/api/hello      # 402 with payment requirements
curl -i localhost:3001/health         # 200, free
```

To drive a real payment you need an x402 client with a funded testnet account;
`@x402/core`'s client plus `ExactStellarScheme` is the pairing this example was
tested against.

## Which hook to use

Two integrations ship, and you want exactly one of them — enabling both reports
every payment twice.

**`createSettleHook`** — the default in `index.ts`. Receives the facilitator's
settle result directly, so nothing is parsed back off the wire. Use it whenever
you can reach the resource server.

**`attachAccensaHook`** — Express middleware that reads the settlement back from
the `X-PAYMENT-RESPONSE` response header once the response finishes. Use it when
the payment middleware is mounted by something you do not control. Mount it
_after_ that middleware, or the header will not exist yet.

## Things that bite

**Do not mount your auth middleware globally.** The x402 handshake arrives with
none of your credentials — the paying agent has no account with you, which is
the point. Mount auth on the routes it protects, as `requireAdmin` is here.

**Reporting must never throw into the request path.** The payment has already
settled by the time the hook runs; a failure to record attribution is a
bookkeeping problem, not a payment problem. Both hooks resolve rather than
reject, and surface failures through `onError`.

**Settlements without a transaction hash are dropped, not guessed.** If the
facilitator reports success but no transaction, there is nothing verifiable to
attribute, and a row whose `tx_hash` never appears on chain looks like
unverifiable revenue.

**A network timeout will not pin a socket.** Reports abort after
`DEFAULT_TIMEOUT_MS` (5s), configurable via `timeoutMs`.
