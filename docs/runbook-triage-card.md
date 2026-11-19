# Runbook triage card

One entry per alert trigger, in runbook order. Act from the row; each fits on a
screen. Full context stays in [`RUNBOOK.md`](RUNBOOK.md).

## 1. `skippedLedgers > 0` — data-loss case

**Symptom:** a sync reply (or its Actions log) carries `skippedLedgers` greater
than 0. `/api/health` may look healthy: the cursor is moving again and the gap
is already behind it.

**First command:**

```bash
gh run list --workflow=sync.yml --limit 5
gh run view <run-id> --log | grep -iE 'skippedLedgers|ledger range'
```

**Then:** poll health for the affected merchant and current lag, the same curl
`stale-check.yml` runs:

```bash
curl -sS --max-time 30 -w '\n%{http_code}\n' "$HEALTH_URL"
```

**Escalate:** declare an incident and page the on-call merchant-platform
engineer. **The lost ledgers cannot be recovered from Soroban RPC** — the gap
has fallen outside `getEvents` retention. Reconstruct from Horizon
(`/accounts/{merchant}/payments` over the ledger-close time range, matched on
`tx_hash`), or accept the loss and annotate the period.

**Link back:** [`skippedLedgers > 0` — data permanently lost](RUNBOOK.md#skippedledgers--0--data-permanently-lost-incident-not-a-warning)

## 2. Excessive cursor lag

**Symptom:** `/api/health` reports `status: warn` or `critical` and `lagLedgers`
has crossed 60k / 90k, but nothing has been skipped yet.

**First command:**

```bash
gh workflow run sync.yml
gh run watch
```

**Then:** if lag does not fall, check whether runs are green and whether the
reply keeps `"drained":false`; a persistent backlog means
`PAGING_BUDGET_MS` is too small for it — dispatch repeatedly, or raise the
budget temporarily until caught up.

**Escalate:** if lag approaches the ~121k-ledger RPC retention window, treat it
as the data-loss case above before it becomes one.

**Link back:** [Excessive cursor lag](RUNBOOK.md#excessive-cursor-lag-status-warn--critical-not-yet-skipped)

## 3. No successful sync in N minutes

**Symptom:** `sync_state.updated_at` is older than `SYNC_STALE_MS` (default 3h).
`/api/health` reports stale even though nothing threw.

**First command:**

```bash
gh workflow run sync.yml
```

**Then:** `gh run list --workflow=sync.yml --limit 5` — is the schedule still
firing? GitHub drops scheduled workflows under load. Check that `SYNC_URL` and
`CRON_SECRET` still match the Vercel project, and that the deployment is not
paused.

**Escalate:** if scheduling is chronically unreliable, move to an external
scheduler (`DEPLOYMENT.md` → "Indexer scheduling").

**Link back:** [No successful sync in N minutes](RUNBOOK.md#no-successful-sync-in-n-minutes-sync_stale_ms-default-3h)

## 4. Persistent `drained: false`

**Symptom:** sync replies keep reporting `"drained":false`: one invocation's
paging budget ends before the backlog does.

**First command:**

```bash
gh workflow run sync.yml
```

**Then:** repeat until a reply says `"drained":true`, watching that the cursor
(`syncedTo`) advances each run rather than the same range being re-read.

**Escalate:** if the backlog outgrows `PAGING_BUDGET_MS` on every attempt,
raise it temporarily and page the owner to explain the volume (long outage, or
a merchant burst).

**Link back:** [Persistent `drained: false`](RUNBOOK.md#persistent-drained-false)
