<div align="center">
  <h1>accensa-app</h1>
  <p><strong>The merchant back-office for x402 sellers on Stellar</strong></p>
  <p>
    <img src="https://img.shields.io/github/actions/workflow/status/accensa/accensa-app/ci.yml?branch=main" alt="CI Status" />
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
    <img src="https://img.shields.io/badge/stellar-x402-blue.svg" alt="Stellar x402" />
  </p>
  <p>
    <a href="https://accensa-dashboard.vercel.app/verify"><strong>Verify a Receipt</strong></a> ·
    <a href="https://accensa-dashboard.vercel.app/dashboard"><strong>Live Dashboard</strong></a> ·
    <a href="https://accensa.github.io/accensa-app/"><strong>Documentation</strong></a> ·
    <a href="https://github.com/accensa/accensa-contracts"><strong>accensa-contracts</strong></a>
  </p>
</div>

> Part of the **[Accensa](https://github.com/accensa)** merchant back-office for x402
> sellers on Stellar. This repo holds the off-chain half — indexer, dashboard, and
> SDK. The Soroban contracts live in
> [`accensa-contracts`](https://github.com/accensa/accensa-contracts).

## The Problem

When you put an x402 paywall in front of an API, payment stops being an event your
backend records and becomes something that happens _on a ledger you don't control_.
An agent pays, retries, and gets its data — and your database never hears about it.

So the merchant is left without the things every other payment stack gives them:

- **No revenue view.** Payments land as SAC transfers on Stellar. Reconstructing
  "what did I earn today, and from which route" means reading chain data, not
  querying your own database.
- **No attribution.** A transfer tells you an amount and a payer. It doesn't tell you
  _which endpoint_ was bought, which is exactly what you need to price anything.
- **No way to answer a dispute.** When an agent operator claims they were double
  charged, both sides are looking at different records.

`accensa-app` is the back-office that closes this. The indexer reconstructs payment
history directly from Stellar, the SDK attributes each payment to the route that
earned it, and the dashboard turns that into something a merchant can actually read —
backed by receipts anyone can verify against
[`ReceiptAnchor`](https://github.com/accensa/accensa-contracts) on-chain.

## Why Stellar

Sub-cent fees are what make per-request agent payments viable in the first place, and
SAC transfer events give the indexer a clean, uniform stream to reconstruct from —
the same shape whether a merchant settles in XLM or native USDC. Batched Merkle
anchoring on Soroban then makes every receipt independently provable for a fraction
of a cent, which is the only way verifiability survives micropayment economics.

## Architecture

```
   agent ──pays──▶ your x402 endpoint
                        │  attachAccensaHook() tags the route
                        ▼
                   Stellar ledger  (SAC transfer)
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
   /api/sync (indexer)           ReceiptAnchor
   decodes SAC transfers         anchors Merkle roots
          │                            │
          ▼                            │
     PostgreSQL                        │
          │                            │
          ▼                            ▼
   Next.js dashboard  ──anchor_batch──▶  ReceiptAnchor
          │                            │
          ▼                            ▼
   GET /api/receipts/:txHash    verify_receipt(leaf, proof)
```

| Component         | Path                                                     | What it does                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Indexer**       | [`apps/web/src/app/api/sync`](apps/web/src/app/api/sync) | Decodes Stellar Asset Contract `transfer` events addressed to the merchant and persists them to PostgreSQL. Runs on a schedule; tracks a ledger cursor so it never rescans or double-counts. |
| **Dashboard**     | [`apps/web/`](apps/web)                                  | Next.js app showing payments, totals, and receipt verification.                                                                                                                              |
| **SDK**           | [`packages/sdk/`](packages/sdk)                          | `verifyReceipt()` for off-chain Merkle verification, and `attachAccensaHook()` / `createSettleHook()` for reporting route-level attribution from your x402 server.                           |
| **Demo merchant** | [`apps/demo-merchant/`](apps/demo-merchant)              | Minimal paid endpoint for exercising the flow end to end.                                                                                                                                    |

## Verifying a Receipt Off-Chain

`verifyReceipt()` mirrors `ReceiptAnchor.verify_receipt` exactly — sorted-pair
SHA-256, so proofs carry no left/right position flags. An agent can check a receipt
without any network call at all:

```ts
import { verifyReceipt } from '@accensa/sdk';

// Batch #1, anchored live on testnet.
const ok = verifyReceipt(
  'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c',
  [
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
    '1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
  ],
  'c6ccdcdb57896fa4999d9dea6a5ef40523d55e46cf32b621d7ea4a582d90e6ac',
); // true
```

The same leaf, proof, and root verify `true` on-chain against
[`CBHRJU7C…`](https://stellar.expert/explorer/testnet/contract/CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV),
and a forged leaf returns `false` in both implementations. See
[DEPLOYMENTS.md](https://github.com/accensa/accensa-contracts/blob/main/DEPLOYMENTS.md#verifying-the-live-deployment-yourself)
for the commands.

## Getting Started

### Prerequisites

Node 22+, pnpm 9, and a PostgreSQL instance.

### Run locally

```bash
# 1. Database
docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres

# 2. Configure apps/web/.env.local
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
MERCHANT_ADDRESS=GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
HOOK_API_KEY=any-shared-secret   # required for /api/hook/settle
# ASSET_CONTRACT_IDS — comma-separated SAC ids whose transfers are revenue.
# Omitted, it defaults to the testnet native XLM SAC. For USDC (or XLM + USDC):
# ASSET_CONTRACT_IDS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# 3. Dashboard (schema is created on first request)
cd apps/web
pnpm install
pnpm dev
```

Then trigger an index run with `curl localhost:3000/api/sync`, and the dashboard at
`/dashboard` will show whatever settled to `MERCHANT_ADDRESS`. If nothing has, it
says so — the dashboard never invents rows to fill space.

### Payment webhooks (`WEBHOOK_URL`)

Set `WEBHOOK_URL` to receive a `POST` for each newly indexed payment. The
indexer **does not wait on your endpoint**. Each insert writes a
`webhook_deliveries` row in the same database transaction; a separate job at
`GET /api/webhooks/deliver` (same `CRON_SECRET` bearer as `/api/sync`) ships
the payload. A host that sleeps, 500s, or rate-limits cannot stall the ledger
cursor — that is how 207 ledgers were lost the last time indexing blocked on
something that was not the chain.

**Retry policy.** Up to 8 attempts over 24 hours. Exponential backoff with 25%
jitter, capped at one hour. 5xx, 429, and transport errors are retried; other
4xx are not. A `429` honours `Retry-After` (delta-seconds or HTTP-date). After
the window the row is `failed` and is listed on the dashboard.

**Signature.** Ed25519 over the exact UTF-8 body bytes, the same scheme as
settlement reporting.

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Signature` | hex-encoded Ed25519 signature of the raw body |
| `X-Accensa-Timestamp` | Unix seconds at sign time |
| `X-Accensa-Delivery-Id` | `webhook_deliveries.id` |

`WEBHOOK_SIGNING_KEY` is a 32-byte Ed25519 private key as hex. Without it,
queued deliveries fail closed rather than going out unsigned. Verify with the
matching public key over the raw request body, then parse JSON.

Body fields: `tx_hash`, `ledger`, `payer`, `amount`, `asset`, `ts`, `route`,
`method`.

Routes: `/` is the landing page, `/dashboard` the merchant view, and `/verify` the
public receipt verifier, which needs no account.

### Route-level attribution

A SAC `transfer` event carries the payer, amount, and asset — never the HTTP route
that was paid for. That mapping exists only inside your server, at the moment x402
settles, so it has to be reported rather than indexed.

Set `HOOK_API_KEY` on both sides, then report settlements from your x402 server:

```ts
import { createSettleHook } from '@accensa/sdk';

resourceServer.onAfterSettle(
  createSettleHook({
    indexerUrl: 'https://your-accensa.vercel.app',
    apiKey: process.env.HOOK_API_KEY,
  }),
);
```

Or, if you only have the response to work from, mount `attachAccensaHook()` after your
x402 middleware — it reads the `X-PAYMENT-RESPONSE` header.

`POST /api/hook/settle` is the endpoint behind both. It is the only write path into
`payments` not derived from the ledger, so it fails closed: with no `HOOK_API_KEY`
configured it accepts nothing. Reported attribution is marked with `hook_reported_at`,
keeping merchant-reported fields distinguishable from on-chain ones. Settlements for
transfers the indexer has not reached yet are staged and completed on the next run.

[`apps/demo-merchant/`](apps/demo-merchant) is a working example.

### Tenancy model

One deployment now supports **multiple merchants**. Each merchant is a row in the
`merchants` table (`address`, and optionally a settlement-reporting `public_key_hex`,
`asset_contract_ids`, `refund_vault_id`, and `webhook_url` that override the
deployment-wide env vars). `payments` and the indexer's ledger cursor
(`sync_state`) are scoped by `merchant_id`, enforced both by application-level query
scoping and by Postgres row-level security as a second line of defence — see
[DESIGN.md](DESIGN.md) for the full design.

Upgrading an existing single-merchant deployment needs no action: the migration
(`migrations/003_multi_merchant.sql`, applied automatically) backfills one `merchants`
row from `MERCHANT_ADDRESS`/`MERCHANT_PUBLIC_KEY` and every existing payment onto it.
Onboarding another merchant means inserting one more row into `merchants`, not
standing up another deployment.

### Contract addresses

Testnet IDs are published in
[`accensa-contracts/deployments/testnet.env`](https://github.com/accensa/accensa-contracts/blob/main/deployments/testnet.env).

### Settling in USDC or multiple assets

`ASSET_CONTRACT_IDS` selects which Stellar Asset Contracts the indexer treats as
revenue. It defaults to the testnet native XLM SAC; set it to a comma-separated
list to index USDC, or XLM and USDC together. `payments.asset` records each
row's asset, and revenue is grouped by asset — never summed across them.

RefundVault holds a **single** token, so a merchant taking both assets refunds
in only one of them unless a second vault is deployed. Receiving USDC also
requires a trustline. Both constraints are spelled out in
[DEPLOYMENT.md](DEPLOYMENT.md#settling-in-usdc-or-multiple-assets).

## Testing

CI runs ESLint, `tsc --noEmit`, the SDK and web test suites, and a production build
on every push. Failures fail the build — no suppressed exit codes.

```bash
cd apps/web     && pnpm lint && pnpm tsc --noEmit && pnpm test
cd packages/sdk && pnpm test
```

The web suite covers SAC event decoding against a **real captured testnet event**,
and the decimal arithmetic that keeps payment amounts off floating point.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security policy in [SECURITY.md](SECURITY.md).

## Contributors

<a href="https://github.com/accensa/accensa-app/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=accensa/accensa-app" />
</a>

## License

MIT — see [LICENSE](LICENSE).

## Setup

See [db-setup.md](db-setup.md) for database setup instructions, and
[DEPLOYMENT.md](DEPLOYMENT.md) for the deployed topology — how Vercel, Supabase,
and the GitHub Actions indexer fit together, which environment variables live
where, and the traps that have cost time here (the alias that `--prod` does not
move, the Hobby cron limit, and the IPv6-only Direct connection string).
