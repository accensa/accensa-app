# Multi-tenant database sharding

Tracks [issue #171](https://github.com/accensa/accensa-app/issues/171).

## Where this starts from

As of this change, `accensa-app` is single-tenant in practice: one
`DATABASE_URL`, one Postgres database, one merchant per deployment. There is
no `workspace_id`, `tenant_id`, or organization concept anywhere in the schema
or in `apps/web/src/lib/auth.ts` (sessions are keyed by Stellar public key).
The issue asks for sharding ahead of that need, as enterprise merchants with
higher IOPS requirements start onboarding.

Given that starting point, this change does **not** stand up Vitess or Citus,
does not provision a second physical database, and does not move any existing
row anywhere. Claiming otherwise would be exactly the kind of fabrication this
codebase's own comments (see `apps/web/src/lib/db.ts`,
`scripts/reconcile-payments/README.md`) are written to avoid. What it does
ship is the routing layer and schema groundwork a real multi-shard rollout
needs, wired in additively so it changes nothing about how the app behaves
today.

## What's here

- **`apps/web/src/lib/shard-router.ts`** — pure, synchronous tenant → shard
  resolution. No I/O, no state beyond the environment.
- **`apps/web/src/lib/db.ts`: `withTenantClient(tenantId, fn)`** — like the
  existing `withClient(fn)`, but opens its connection to whichever shard
  `shard-router` resolves for `tenantId`, instead of always connecting to
  `DATABASE_URL`.
- **`migrations/006_tenant_shard_columns.sql`** — adds
  `payments.workspace_id` (`NOT NULL DEFAULT 'default'`) and an index on it.
  Also applied idempotently in code by `ensureSchema`, matching the existing
  pattern for `001`/`002`.
- This document.

None of the existing call sites of `withClient` (`/api/payments`, `/api/sync`,
`/api/routes`, `/api/hook/settle`, and the auth/merchant/inventory handlers
that came later) were touched. They keep connecting to `DATABASE_URL` exactly
as before.

## Why rendezvous hashing instead of a shard map table

Two designs were available for "which shard owns tenant X":

1. A **lookup table** (`tenant_id → shard_id`) persisted somewhere.
2. A **pure function** of `(tenant_id, current shard list)`, computed
   in-process on every call.

This uses (2): Highest Random Weight / rendezvous hashing. For each candidate
shard, compute `SHA-256(tenantId + " " + shardId)`, and route to the shard
with the highest resulting value. It's deterministic (same inputs, same
answer, everywhere, with no coordination), and it has the key property a
naive `hash(tenantId) % shardCount` lacks: changing the shard list only
remaps the tenants whose winning shard was the one that changed. Adding a
5th shard to 4 moves roughly `1/5` of tenants, not close to all of them;
removing a shard only moves the tenants that were on it. `shard-router.test.ts`
pins both properties with a statistical test over 2,000 synthetic tenant ids.

A lookup table was deliberately not built. It solves a problem this codebase
does not have yet (assignments that must be pinned independently of the
hash — e.g. because a tenant was manually moved for load-balancing reasons)
at the cost of a piece of state that must be created, migrated, and kept
consistent before a single tenant exists to put in it. If manual pinning
becomes necessary, it composes cleanly with this design: an optional
override table consulted before falling back to `pickShard` is a small
addition, not a rewrite.

## Configuration

## Configuration and Topology Contracts

`DATABASE_SHARDS` — optional environment variable parsed by `shardsFromEnv` in `apps/web/src/lib/shard-router.ts:80`.

### Parsing Contract (`shard-router.ts:80`)

1. **Unset or Empty String**: When `DATABASE_SHARDS` is absent or whitespace-only, `shardsFromEnv()` falls back directly to `DATABASE_URL` with a single shard `{ id: "default", connectionString: process.env.DATABASE_URL }`. If neither is configured, it throws an explicit error: `"Neither DATABASE_SHARDS nor DATABASE_URL is configured"`.
2. **JSON Structure**: When present, `DATABASE_SHARDS` must be a valid, non-empty JSON array of objects. Any syntax error throws `"DATABASE_SHARDS is not valid JSON: <details>"`. An empty array `[]` throws `"DATABASE_SHARDS must be a non-empty JSON array of {\"id\", \"connectionString\"}"`.
3. **Element Validation**: Each entry must contain a non-empty string `id` and a non-empty string `connectionString`. Any missing or non-string property immediately throws `"DATABASE_SHARDS[i] must be an object with non-empty string \"id\" and \"connectionString\""`.

### Concrete Environment Configuration Examples

#### Single-line Environment String (Production / Vercel / Railway)

```bash
DATABASE_SHARDS='[{"id":"shard-us-east-1","connectionString":"postgres://postgres.abc:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"},{"id":"shard-eu-west-1","connectionString":"postgres://postgres.xyz:[password]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require"}]'
```

#### Formatted Shard Topology Schema (Multi-Region / High-Availability)

```json
[
  {
    "id": "shard-primary-01",
    "connectionString": "postgres://accensa_app:secret@db-p01.internal:5432/accensa_shard_01?sslmode=verify-full&sslrootcert=/etc/ssl/certs/pg.crt"
  },
  {
    "id": "shard-primary-02",
    "connectionString": "postgres://accensa_app:secret@db-p02.internal:5432/accensa_shard_02?sslmode=verify-full&sslrootcert=/etc/ssl/certs/pg.crt"
  }
]
```

Each `connectionString` follows the same rules as `DATABASE_URL` today — notably, the Supabase _session pooler_ host in production (port 5432 or 6543), since Vercel serverless functions have no IPv6 route to Supabase direct (IPv6-only) connections.

## Health Check Probes and Shard Monitoring

Operating multiple database shards requires continuous health telemetry to detect degraded nodes before requests fail:

1. **Liveness Probe**: Monitored endpoints execute `SELECT 1;` across all configured shards in parallel:
   ```sql
   SELECT 1;
   ```
2. **Transaction & Readiness Check**: Verifies that the tenant connection can set the RLS session variable and read the sync cursor:
   ```sql
   SET LOCAL accensa.merchant_id = 'health_check';
   SELECT cursor FROM sync_state LIMIT 1;
   ```
3. **Latency Thresholds**: Shard connection timeout should be set to 3000ms. If a shard fails 3 consecutive health probes, the routing layer or upstream load balancer triggers failover alerts.

## Failover Procedures

Because Rendezvous Hashing (HRW) determines shard ownership deterministically without a central coordinator, shard failover requires deliberate operational steps:

### 1. Read-Replica Promotion (Primary Failure)

When a physical shard primary fails:

1. Promote the shard's read replica to primary at the database hosting layer (e.g., Supabase / RDS Multi-AZ automatic failover).
2. The shard `id` in `DATABASE_SHARDS` remains identical, while the connection string updates to the promoted primary endpoint if endpoints are not DNS-managed.
3. No tenant re-hashing occurs because shard IDs did not change.

### 2. Shard Replacement and Tenant Evacuation

If a physical database is permanently lost or must be decommissioned:

1. **Planned Maintenance / Decommissioning**:
   - To evacuate a shard (e.g., `shard-old`), remove `{"id": "shard-old", ...}` from `DATABASE_SHARDS`.
   - By Rendezvous Hashing mathematical invariants, only tenants whose highest weight was `shard-old` will migrate to their second-highest weight shard. Tenants on all other shards remain unaffected.
   - Run the data export/import script to copy tenant rows from the snapshot of `shard-old` to each tenant's newly assigned destination shard.
2. **Emergency Failover**:
   - Update the failing shard's `connectionString` in `DATABASE_SHARDS` to point to a hot standby or restored point-in-time recovery (PITR) instance.
   - Keep the `id` unchanged to prevent tenant reassignment.

## Read-Replica vs. Primary Routing

In high-throughput multi-tenant deployments:

- **Write Operations (Mutations)**: Payments (`/api/payments`), sync ingestion (`/api/sync`), settlements, and inventory reservations must strictly route through the primary connection pooler (`withTenantClient` to primary `connectionString`).
- **Read-Only Operations**: Analytics, public catalog queries, and dashboard reporting can leverage read-replica connection strings (`replicaConnectionString`) where transient replication lag is tolerable, leaving primary IOPS reserved for state transitions.

## Using it

```ts
import { withTenantClient } from '@/lib/db';

await withTenantClient(workspaceId, async (client) => {
  // queries against the shard that owns `workspaceId`
});
```

`workspaceId` is caller-supplied on purpose — this repo has no
workspace/tenant table to look it up from yet. The first caller to adopt
`withTenantClient` is also the first caller that needs to decide where a
workspace id comes from (a header, a claim on the session JWT, a new table).
That decision is left to the feature that actually needs multi-tenancy,
rather than guessed at here.

## Cross-shard queries

The acceptance criteria for #171 calls for cross-shard query patterns to be
"eliminated or heavily optimized." With a single logical tenant per
deployment today, there are no cross-shard queries in this codebase to
eliminate — every existing query already reads and writes exactly one
database. The design constraint that matters here is forward-looking:
`withTenantClient` takes one `tenantId` and hands back one connection, on
purpose, rather than a fan-out helper that queries every shard and merges
results. That shape makes a future cross-shard aggregation (e.g. "total
revenue across all workspaces") an explicit, visible thing someone has to
build — a loop over `shardsFromEnv()` calling into each shard and merging in
application code — rather than something a single innocuous-looking query
could do by accident.

## Rollout plan, when a second shard is actually needed

1. Provision the new database. Point a new entry in `DATABASE_SHARDS` at it.
   `pickShard` immediately starts routing a fraction of tenants there for any
   caller using `withTenantClient` — for brand-new tenants (empty database),
   this is sufficient on its own.
2. For an **existing** tenant being moved to a new shard: this is a data
   migration (copy that tenant's rows to the new database, verify, then
   cut the tenant over), not something `shard-router.ts` does automatically.
   Nothing in this change performs that copy — it is intentionally out of
   scope until a specific tenant needs isolating (the "noisy neighbor" case
   the issue describes), at which point the migration can target exactly that
   tenant's rows instead of guessing at all of them upfront.
3. Convert the call sites that should be tenant-aware
   (`/api/payments`, `/api/sync`, `/api/routes`, `/api/hook/settle`) from
   `withClient` to `withTenantClient` once there is an actual source for
   `workspaceId` in each request (see "Using it," above).

## What's explicitly not done here

- No Vitess or Citus. Neither changes the answer to "which shard owns this
  tenant," which is the actual gap `shard-router.ts` fills; both are cluster
  operations tooling that would sit _below_ this routing decision if adopted
  later, and adopting either is a significant infrastructure commitment this
  PR isn't positioned to make unilaterally.
- No second physical database is provisioned by this change.
- No existing row's data is moved. `workspace_id` defaults every row to
  `'default'`, which is where all of them already, correctly, are.
- No call site was switched to `withTenantClient`. It ships unused by
  production code paths, ready for the first tenant-aware feature to adopt.
