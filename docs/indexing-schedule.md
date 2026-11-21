# Indexing schedule — where every interval is defined

Nothing in this document changes a cadence. It records what the repository
already declares, so a claim about "how often the indexer runs" can be checked
against a file instead of a summary of one.

The background (why the manifest and the workflow disagree, and the Hobby-plan
constraint behind that) is in [`DEPLOYMENT.md`](../DEPLOYMENT.md#indexing-cadence--read-this-before-trusting-the-cron).

## Every schedule, and the interval it produces

| Schedule                                | Defined in                                | Interval it produces                                                                                        | What it triggers                                    |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Vercel cron                             | `apps/web/vercel.json:3-7`                | Once a day, at 00:00 UTC (`0 0 * * *`)                                                                      | `GET /api/sync`                                     |
| GitHub Actions trigger                  | `.github/workflows/sync.yml:14-15`        | Hourly, on the hour (`0 * * * *`)                                                                           | Starts one `sync` job                               |
| In-run loop, sync call                  | `.github/workflows/sync.yml:58-104`       | Every 5 minutes (`sleep 300`) for 55 minutes (`END_TIME = now + 3300`)                                      | Authenticated `GET /api/sync`                       |
| In-run loop, webhook delivery           | `.github/workflows/sync.yml:94-101`       | Once per loop iteration — the same 5 minutes                                                                | Authenticated `GET /api/webhooks/deliver`           |
| Manual workflow dispatch                | `.github/workflows/sync.yml:13`           | On demand                                                                                                   | Starts one `sync` job                               |
| Dashboard "Sync now"                    | `apps/web/src/app/dashboard/page.tsx:757` | On demand, rate-limited to one run per 60 s (`MANUAL_COOLDOWN_MS`, `apps/web/src/app/api/sync/route.ts:91`) | `POST /api/sync` for the signed-in merchant         |
| Freshness thresholds shown to merchants | `apps/web/src/lib/sync-status.ts:26-27`   | Live ≤ 15 minutes; lagging ≤ 3 hours; stale beyond that                                                     | Display only — decides the badge, schedules nothing |

## Which source wins

**The Actions in-run loop sets the practical cadence.** A workflow run fires
every 5 minutes for 55 of the 60 minutes it is alive, so `sync.yml` accounts for
roughly twelve indexer runs an hour; the Vercel cron accounts for one per day.
Where the two disagree, the workflow is the interval an operator will actually
observe.

The daily Vercel cron still fires once at 00:00 UTC and is not part of the
workflow's concurrency group (`.github/workflows/sync.yml:17-20`, group
`indexer-sync`, `cancel-in-progress: true`), so it is a thirteenth writer rather
than a serialised one. That is why `DEPLOYMENT.md` says not to raise the cron
_and_ keep the workflow after leaving Hobby: two unsynchronised writers contend
for the same cursor.

The hourly trigger is the only part of the Actions schedule GitHub can delay. A
delayed trigger lengthens the gap between one run's 55-minute loop ending and the
next run starting; it does not change the 5-minute sleep inside a run. The 15
minute / 3 hour thresholds in `sync-status.ts` exist to absorb that gap without
telling a merchant the indexer is broken.

## Not in scope here

- No workflow, `apps/web/vercel.json` or `sync-status.ts` line is edited by this
  document. It describes them as they are.
- `docs/RUNBOOK.md` is owned elsewhere; questions about alerting on a stalled
  cursor belong there, not in this table.
