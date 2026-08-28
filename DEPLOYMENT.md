# Deployment topology

How the deployed pieces fit together, and the traps that have actually cost time
here. No credentials appear in this file, and none should be added to it.

## The shape of it

```
                    GitHub Actions (sync.yml)
                    scheduled every 5 min
                             │
                             │ POST /api/sync
                             │ Authorization: CRON_SECRET
                             ▼
  browser ──────▶  Vercel project `web`  ──────▶  Supabase Postgres
                   (Next.js, apps/web)     pooler   payments, sync_state
                             │
                             │ Soroban RPC (read-only)
                             ▼
                   Stellar testnet
                   ReceiptAnchor · RefundVault
```

Three moving parts, and only one of them is Vercel's:

- **`web`** — the Next.js app in `apps/web`. Serves the dashboard, the verifier,
  and the API routes. Aliased to `accensa-dashboard.vercel.app`.
- **Supabase Postgres** — holds `payments` (indexed chain data) and `sync_state`
  (the indexer's ledger cursor). Schema is created on first request; see
  `db-setup.md`.
- **GitHub Actions** — the real indexing cadence. Explained below, because the
  `vercel.json` cron is misleading on its own.

The documentation site in `apps/docs` is **not** deployed on Vercel. It is built
by GitHub Actions and published to GitHub Pages at
<https://accensa.github.io/accensa-app/>.

> A second Vercel project named `docs` used to serve `accensa-docs.vercel.app`
> from the same directory. It was last deployed on 2026-07-13 and had drifted
> into serving unmodified Docusaurus scaffold copy, while every "Documentation"
> link in the org still pointed at it. The project was deleted on 2026-08-14;
> `accensa-docs.vercel.app` now returns 404 and nothing should link to it.

## Indexing cadence — read this before trusting `vercel.json`

`apps/web/vercel.json` declares a **daily** cron. That is not the real cadence,
and it is not a design choice:

> On the Vercel Hobby plan, declaring more than one cron run per day is a **hard
> deploy failure**, not a silent clamp. The deploy is rejected.

So the schedule that matters lives in `.github/workflows/sync.yml`, which hits
`/api/sync` every 5 minutes. GitHub throttles high-frequency scheduled workflows,
so in practice it lands **every one to three hours**. `apps/web/src/lib/sync-status.ts`
sets its staleness thresholds from that observed behaviour rather than from the
declared schedule, so a normal gap is not reported to the merchant as a fault.

If you move off Hobby, raise the `vercel.json` cron and retire the Actions
workflow — do not run both, or the cursor gets contention from two writers.

**The cadence is not cosmetic.** Soroban RPC serves `getEvents` for roughly the
last 121,000 ledgers, about a week of testnet. If the cursor stops advancing for
longer than that it falls outside the retained window, and the ledgers in between
are unrecoverable — no later run can reach them. A sync that skipped ledgers this
way reports `skippedLedgers` in its response and `sync.yml` raises a warning; it
is the one failure here that cannot be fixed by running the job again.

## Indexer scheduling — the options weighed

The sleep-looping runner in `sync.yml` works, and its diagnostics are the reason
several silent-failure modes are now caught. But as the production scheduler for
a component that has already failed silently once, it has real costs: it holds a
runner for ~55 min/hour doing nothing but sleeping (~660 runner-minutes/day,
billed as occupied on any non-free plan), and if scheduling stops there are no
runs, therefore no red runs, therefore no signal.

| Option                                                                                                       | Cost                                                                                                                           | Reliability                                                                                                                                                                                                   | Notes                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Vercel Cron, paid plan**                                                                                | Pro is **$20/user/month**; the only gain over Hobby that this project needs is sub-daily cron.                                 | Minute-level schedules, run by Vercel, no runner to keep alive. Still needs external cessation monitoring — a paused project is as silent as a stopped workflow.                                              | Cleanest fit _if_ the team is already on Pro for other reasons. Buying Pro solely for cron is poor value at one merchant.                                                   |
| **2. External scheduler** (cron-job.org, Upstash QStash, EventBridge Scheduler) hitting `/api/sync` directly | cron-job.org: **free**. QStash: free ≤ 500 msg/day, then usage-priced. EventBridge Scheduler: ~$0 at this volume.              | High. The scheduler is a dedicated, monitored service; most include their own failure alerting. Adds one third-party dependency in the critical path.                                                         | `/api/sync` is already a plain authenticated GET, so this is a config change, not a code change. **Recommended** — it removes the runner cost _and_ the blind spot, for $0. |
| **3. Long-running worker** (Railway/Fly/Render process, or a container)                                      | ~$5/month minimum for an always-on small instance.                                                                             | Most control, most operational surface. **Re-opens the extraction that caused the original outage** — the indexer logic would move out of `apps/web` again. Note that history explicitly if this is proposed. | Only worth it if the indexer grows past what a 60 s function invocation can do. It cannot today.                                                                            |
| **4. Keep the loop, fix the defects**                                                                        | Same ~660 runner-min/day. Free on public repos; on GitHub Team/Enterprise-billed minutes it is the most expensive option here. | Acceptable once the defects below are fixed.                                                                                                                                                                  | What this repo does today, plus the fixes in this PR.                                                                                                                       |

**Decision: option 4 now, with the specific defects fixed, and option 2
(cron-job.org or EventBridge) as the documented migration when the team wants the
runner cost gone.** Option 2 is strictly better on cost and on the cessation
blind spot; it is not adopted in this PR only because it needs an account and a
secret that a maintainer must create, not a code change a contributor can land.

Defects fixed in `sync.yml` in this PR:

- **`cancel-in-progress: true` → `false`.** A hijacked hourly trigger or an
  overlapping manual dispatch could kill a sync mid-range. Indexing is
  idempotent so nothing corrupted, but the run was lost.
- **Hour-boundary gap closed.** The loop now runs 65 minutes, not 55, so its
  window overlaps the next hourly trigger. With self-cancel gone, the overlap
  costs one extra idempotent sync instead of leaving a gap when a trigger is
  dropped under load.
- **External cessation monitor.** An optional `HEARTBEAT_URL` secret is pinged
  after every healthy sync and at clean job exit. Point it at a dead-man's
  switch (healthchecks.io free tier, cronitor, cron-job.org's own monitor) with
  a grace period of ~90 min. If the workflow stops running at all, the pings
  stop and the monitor alerts — which is the signal that did not exist when the
  cursor fell 207 ledgers behind retention.

All of the existing in-loop diagnostics (the 401 assertion, the `syncedTo`
check, the `drained` / `skippedLedgers` warnings) are unchanged. Alerting on
those warnings — routing them somewhere a human sees them — is separate work.

## Reading a sync response

```json
{
  "success": true,
  "latestLedger": 4067288,
  "startLedger": 3967288,
  "syncedTo": 4067288,
  "skippedLedgers": 0,
  "drained": true,
  "pages": 11,
  "windows": 11,
  "scanned": 1,
  "decoded": 1,
  "inserted": 1
}
```

| Field                              | Meaning                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `syncedTo`                         | Where the cursor now stands. A reply without this field is not the indexer — `sync.yml` fails the run on it.    |
| `drained`                          | False when paging stopped against the time budget. Not a fault; the next run resumes from `syncedTo`.           |
| `windows`                          | `getEvents` calls made. Requests are bounded to 10,000 ledgers because the RPC silently truncates wider ranges. |
| `skippedLedgers`                   | Ledgers lost to the retention window. Should always be 0.                                                       |
| `scanned` / `decoded` / `inserted` | Events matched, decoded as transfers, and written.                                                              |

## Settling in USDC or multiple assets

The indexer defaults every setting to testnet native XLM. To index USDC — or
XLM and USDC together — set `ASSET_CONTRACT_IDS` on the `web` project to a
comma-separated list of the Stellar Asset Contract ids whose `transfer` events
are revenue:

```
ASSET_CONTRACT_IDS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA,CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

(The first id above is the testnet USDC SAC; the second is testnet native XLM.
Confirm current ids against
[`accensa-contracts/deployments/testnet.env`](https://github.com/accensa/accensa-contracts/blob/main/deployments/testnet.env)
before deploying.)

Each `payments` row carries its own `asset` (`"native"` or `"USDC:GA…"`),
decoded from the transfer event's optional asset topic. Revenue **must** be
grouped by asset and never summed across assets — a figure that added XLM and
USDC into one number is meaningless. Any dashboard total that mixes assets is a
bug; see `apps/web/src/lib/revenue-analytics.ts`.

### RefundVault holds one token

`RefundVault` is initialised with a single token at deploy time. A merchant who
takes both XLM and USDC has **one vault and one refund asset**: a refund of a
payment made in the other asset will be rejected by the contract (the preflight
in `/api/refund/preflight` surfaces this before any signing prompt).

If a merchant needs to refund in more than one asset, deploy **one RefundVault
per asset** and point `NEXT_PUBLIC_REFUND_VAULT_ID` at the right one per refund
flow. There is no multi-asset vault, and adding one is a contract change tracked
in `accensa-contracts`, not here.

A merchant also cannot **receive** USDC at all without a trustline to the USDC
issuer. A missing trustline for a configured `ASSET_CONTRACT_IDS` asset must be
surfaced distinctly from "no payments yet" — an empty list is also what an
indexer outage looks like, and the two must not be indistinguishable.

## Database connection

Use the **Session pooler** connection string, not Direct.

Direct is IPv6-only. Vercel Functions have no IPv6 route, so a Direct URL
produces connection timeouts that look like a database outage and are not.

The pooler host looks like `aws-1-<region>.pooler.supabase.com`.

## Environment variables

| Variable                      | Where                          | What it does                                                                                                                                                                       |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Vercel (`web`)                 | Supabase **session pooler** connection string.                                                                                                                                     |
| `CRON_SECRET`                 | Vercel (`web`) + GitHub secret | Shared by `/api/sync` and `sync.yml`. Anonymous callers get `{"error":"Unauthorized"}`.                                                                                            |
| `SYNC_URL`                    | GitHub secret                  | The `/api/sync` endpoint the workflow posts to.                                                                                                                                    |
| `HOOK_API_KEY`                | Vercel (`web`)                 | Gates `/api/hook/settle`. **Absent means the endpoint fails closed**, not open.                                                                                                    |
| `NEXT_PUBLIC_REFUND_VAULT_ID` | Vercel (`web`), optional       | Overrides the built-in RefundVault contract id.                                                                                                                                    |
| `STELLAR_NETWORK_PASSPHRASE`  | Vercel (`web`), optional       | Stellar network passphrase for auth challenges and RPC calls. Defaults to `Test SDF Network ; September 2015`. Set to `Public Global Stellar Network ; September 2015` for pubnet. |

Set them per environment (`production`, `preview`, `development`) — Vercel does
not share values across them.

### `vercel env add` will silently store an empty value

Agent and CI shells default to `--non-interactive`, and piping to stdin in that
mode stores **nothing** without erroring:

```bash
vercel env add DATABASE_URL production --value "$CONNECTION_STRING"   # correct
echo "$CONNECTION_STRING" | vercel env add DATABASE_URL production    # stores empty
```

`vercel env ls` listing the key proves the key exists. It proves nothing about
its contents.

Vercel also marks new variables **sensitive** by default, and `vercel env pull`
returns sensitive values blank _by design_ — a blank in your local pull is not
evidence the remote value is blank. Use `--no-sensitive` for non-secrets if you
want to read them back.

## Deploying

Two steps, not one:

```bash
git checkout main && git pull
vercel deploy --prod
vercel alias set <new-deployment-url> accensa-dashboard.vercel.app
```

**`--prod` alone does not move the alias.** `accensa-dashboard.vercel.app` is
assigned manually, so a production deploy leaves it pointing at the previous
build and the live site looks unchanged. This has caught people more than once.

Environment variables apply to **new builds only**. Changing one requires a
redeploy before it takes effect.

The repo root `.vercel/project.json` is linked to project `web`; that link is
what makes monorepo deploys resolve correctly from the root.

## Verifying a deploy

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/
curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/dashboard
curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/verify
curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/batches/1
curl -s -o /dev/null -w "%{http_code}\n" https://accensa-dashboard.vercel.app/batches/999  # expect 404
curl -s https://accensa-dashboard.vercel.app/api/sync                                      # expect Unauthorized
```

The `/batches/999` 404 and the `/api/sync` rejection are the two that catch a
half-configured deploy — a 200 from either means something is wrong.

## Rotating the database password

```
Supabase → Settings → Database → Reset database password
```

Then update `DATABASE_URL` in every Vercel environment that uses it and
redeploy, since env changes only reach new builds. Take the **session pooler**
string, per the IPv6 note above.
