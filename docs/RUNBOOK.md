# Indexer runbook

Alerts fired by `.github/workflows/stale-check.yml` polling `GET /api/health`
(issue #90). Owner: **the on-call merchant-platform engineer** (set the real
name/rotation here).

`/api/health` returns `{ status, head, merchants: [{ lagLedgers, ageMs, status,
reasons }] }` and a `503` when any merchant is `critical`.

## `skippedLedgers > 0` — data permanently lost (incident, not a warning)

**What fired:** a sync response carried `skippedLedgers` > 0. The cursor fell
outside the Soroban RPC `getEvents` retention window (~121,000 ledgers on
testnet, ~a week) before catching up, so the transfers in the gap were never
seen and **no later run can reach them**.

**Check:** the failing sync run's log for the ledger range; `/api/health` for
current lag; which merchant(s).

**Do:**
1. Declare an incident. Payment records are the product; a gap is missing revenue rows.
2. Stop the bleeding — get the cursor advancing again (see "excessive lag").
3. Recovery of the lost ledgers: **there is none from Soroban RPC.** Options,
   in order of preference: reconstruct the affected transfers from Horizon
   (`/accounts/{merchant}/payments` over the ledger-close time range, matched
   back to `payments.tx_hash`); or, if Horizon retention has also passed,
   **accept the loss** and annotate the affected period. The 2026-08 post-mortem
   answer for 207 ledgers was "gone for good" — do not imply otherwise to the merchant.

## Excessive cursor lag (`status: warn` / `critical`, not yet skipped)

**What fired:** `lagLedgers` crossed `SYNC_LAG_WARN_LEDGERS` (60k) or
`SYNC_LAG_CRITICAL_LEDGERS` (90k). Ledgers are not lost yet, but the margin to
RPC retention is shrinking. At ~5s/ledger, 90k lag is still ~29h of head-room.

**Check:** is `sync.yml` running and green? Are `SYNC_URL` / `CRON_SECRET`
valid? Is `drained: false` persisting (backlog outgrowing the paging budget)?

**Do:** `workflow_dispatch` `sync.yml` manually and watch it advance. If
`drained: false` persists across several runs, the one-invocation paging budget
(`PAGING_BUDGET_MS`) is too small for the backlog — run repeatedly / raise it
temporarily until caught up.

## No successful sync in N minutes (`SYNC_STALE_MS`, default 3h)

**What fired:** `sync_state.updated_at` is older than the threshold — the sync
is not running at all, the "it stopped and everything stayed green" failure.

**Check:** the `sync.yml` Actions history — is it still being scheduled? GitHub
drops scheduled workflows under load and after 60 days of repo inactivity.
Secrets expired? Vercel project paused?

**Do:** re-enable / re-dispatch `sync.yml`; renew secrets; if scheduling is
chronically unreliable, migrate to an external scheduler (see
`DEPLOYMENT.md` → "Indexer scheduling").

## Persistent `drained: false`

Same as "excessive lag" with `drained: false` — the backlog is growing faster
than one invocation clears it. Catch up with repeated manual runs, then
investigate why the backlog appeared (a long outage, or a merchant with a burst
of volume).
