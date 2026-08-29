# reconcile-payments

Proves the `payments` table can be rebuilt from the Stellar ledger by someone
who does not trust us. See [issue #170](https://github.com/accensa/accensa-app/issues/170).

`apps/web/src/app/api/sync/route.ts` is a proprietary indexer: it writes into
a Postgres database only Accensa operates, and the dashboard reads from it. If
that database were wrong, nothing today would catch it. This package is the
independent check: it reconstructs the ledger-derived columns of `payments`
directly from chain data, using a decoder and RPC client it does not share
with the indexer, and reports where the two disagree — row by row, not as a
count.

## The trust boundary

Not every column in `payments` comes from the chain. `route`, `method` and
`request_id` are reported by the merchant's own server, via
`POST /api/hook/settle` — a SAC `transfer` event has no notion of an HTTP
route, so there is nothing on the ledger to reconstruct them from. This tool
makes that boundary explicit rather than implying it can check everything:

| Column                                                | Provenance        | This tool                                                 |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| `tx_hash`, `ledger`, `payer`, `amount`, `asset`, `ts` | Stellar ledger    | Reconstructed and compared                                |
| `route`, `method`, `request_id`, `hook_reported_at`   | Merchant-reported | Reported as out of scope, never reconstructed or compared |

`trust-boundary.mjs` is the single source of truth for this table; every
report this tool prints renders it, in full, so a reader never has to infer
the boundary.

## Why the decoder is duplicated

`decode.mjs` and `rpc.mjs` re-implement the same SAC `transfer`-event decoding
and Soroban RPC paging that `apps/web/src/lib/stellar-events.ts` and
`apps/web/src/lib/event-pager.ts` already do, on purpose, and neither imports
the other. If this package called into the indexer's own decode path, it
would agree with the indexer by construction — proving nothing. Its value is
being a _second, independent_ implementation whose agreement (or disagreement)
with the indexer's output is actual evidence. `decode.test.mjs` runs this
decoder against the same real captured testnet fixture
(`apps/web/src/lib/__fixtures__/sac-transfer-events.json`) that
`stellar-events.test.ts` uses, and asserts it reaches the same answer — that
cross-check is the point.

## Running it

Two modes, selected by whether `--database-url` / `DATABASE_URL` is given.

### 1. Rebuild-only — for anyone, with no Accensa infrastructure access

This is how a third party independently verifies the chain side of a
merchant's payment history: only a public Soroban RPC endpoint and the
merchant's public Stellar account address are needed. No secret, no database
credential, nothing that belongs to Accensa.

```bash
cd scripts/reconcile-payments
pnpm install   # or: npm install, from within this directory
node cli.mjs \
  --merchant GD4C3LWGIXNDWC3G2UTIKXA4TN2KCBOCP5G6R6YT6WBHVDEP4D4GRMK4 \
  --rpc-url https://soroban-testnet.stellar.org \
  --asset-contract-ids CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --from-ledger 3700000 \
  --out rebuilt.json
```

This prints every transfer to that merchant it found on chain, in the given
ledger range, plus the trust-boundary table. Nothing is compared to anything
Accensa runs — there is nothing here to trust us on. Anyone can take
`rebuilt.json` and compare it against whatever the merchant or Accensa claims
their revenue was for that range.

### 2. Rebuild + diff against production — what Accensa runs

Adding `--database-url` (or `DATABASE_URL`) additionally connects, read-only,
to the production database and diffs the rebuild against the live `payments`
table, row by row:

```bash
node cli.mjs \
  --merchant "$MERCHANT_ADDRESS" \
  --from-ledger 3700000 \
  --database-url "$DATABASE_URL"
```

Exits `0` when reconciled, non-zero when any row disagrees — including when
the row _counts_ match but a column doesn't (a matching count with a
mismatched amount is exactly the failure this exists to catch; see the
`mismatched` section of the report, not just its length).

A database row with `ledger IS NULL` is a merchant-reported row staged ahead
of indexing (see `recordSettlement` in `apps/web/src/lib/db.ts`) — the tool
reports it separately as `pendingOnChain`, not as a discrepancy, since it is
not yet a claim about the chain at all.

## Running in CI

`.github/workflows/reconcile.yml` runs this on a schedule against production,
using the same `DATABASE_URL` and `MERCHANT_ADDRESS` secrets the indexer
itself uses, and fails the workflow loudly on any mismatch. The unit tests
here (`node --test .`) also run in the main `ci.yml`, on every push and PR,
using only the static fixture — no live RPC or database calls, so they need
no secrets and run for every contributor.

## Non-goals

This package is not folded into `apps/web` or the running indexer, and never
writes to the database. It has no notion of `route`, `method` or
`request_id`, and does not attempt to reconstruct them — see "The trust
boundary" above. A rebuild that silently invented merchant-reported columns to
look complete would be worse than one that says plainly it can't.
