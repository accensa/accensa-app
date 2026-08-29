# Issue #179: Multi-region Active-Active Database Replication

## Overview

Migrate the indexer's single-region PostgreSQL database to a globally distributed system (CockroachDB or Cloud Spanner) with active-active writes across multiple regions. Achieve <100ms read/write latency globally for merchant dashboard users.

## Problem

Current architecture:
- **Single region**: Supabase PostgreSQL in us-east-1
- **Latency**: 200-500ms for Asia/Europe merchants
- **Availability**: Single point of failure
- **Scalability**: Vertical scaling only (limited by single node)

Global merchant base requires:
- **Low latency**: <100ms for dashboard queries from anywhere
- **High availability**: 99.99% uptime (no region failures)
- **Write conflicts**: Handle concurrent writes from multiple regions
- **Consistency**: Causal consistency for payment records

## Solution: CockroachDB vs. Cloud Spanner

### CockroachDB (Recommended)

**Why CockroachDB**:
- PostgreSQL-compatible (minimal code changes)
- Active-active writes (no leader election)
- Built-in conflict resolution (CRDT-like)
- Self-managed or fully-managed (CockroachDB Cloud)
- Pricing: $0.50/hour per node (~$360/month for 3-region cluster)

**Architecture**:
```
┌─────────────────────────────────────────────────────────┐
│                   CockroachDB Cluster                   │
│                                                         │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐│
│  │   us-east-1   │  │   eu-west-1   │  │  ap-south-1 ││
│  │   (Primary)   │  │  (Secondary)  │  │ (Secondary) ││
│  │               │  │               │  │             ││
│  │  3 nodes      │  │  3 nodes      │  │  3 nodes    ││
│  │  Replication  │◄─┼──Replication──┼─►│ Replication ││
│  │  Factor: 3    │  │  Factor: 3    │  │ Factor: 3   ││
│  └───────┬───────┘  └──────┬────────┘  └──────┬──────┘│
│          │                 │                   │       │
└──────────┼─────────────────┼───────────────────┼───────┘
           │                 │                   │
           ▼                 ▼                   ▼
    ┌──────────┐      ┌──────────┐       ┌──────────┐
    │ Indexer  │      │ Indexer  │       │ Indexer  │
    │ (Vercel) │      │ (Vercel) │       │ (Vercel) │
    │ us-east  │      │ eu-west  │       │ ap-south │
    └──────────┘      └──────────┘       └──────────┘
```

**Data Distribution**:
- `payments` table partitioned by `asset` (geo-locality hint)
- `sync_state` table replicated globally (small, frequently read)
- Automatic rebalancing as data grows

### Cloud Spanner (Alternative)

**Why Spanner**:
- Google-managed, zero ops
- Stronger consistency guarantees (TrueTime API)
- Better for financial data (exact consistency)
- Pricing: $0.90/hour per node (~$650/month for 3-region)

**Trade-off**: More expensive, less PostgreSQL-compatible (requires more code changes)

## Migration Strategy

### Phase 1: Dual-Write Period

```
1. Deploy CockroachDB cluster (3 regions, 9 nodes total)
2. Replicate schema from Supabase PostgreSQL
3. Modify indexer to write to BOTH databases:
   - Primary: Supabase PostgreSQL (current)
   - Secondary: CockroachDB (new)
4. Compare writes for consistency (log discrepancies)
5. Run for 1 week to verify replication correctness
```

### Phase 2: Read Migration

```
6. Deploy new Vercel regions (eu-west-1, ap-south-1)
7. Add geo-routing: Route dashboard requests to nearest Vercel region
8. Vercel edge functions read from CockroachDB
9. Monitor latency: Should be <100ms p99 globally
10. Rollback plan: Flip reads back to Supabase if issues
```

### Phase 3: Write Cut-Over

```
11. Stop dual-write, make CockroachDB primary
12. Disable Supabase writes
13. Monitor for 24 hours: No data loss, latency targets met
14. If stable: Decommission Supabase PostgreSQL
15. If issues: Rollback to Supabase, debug CockroachDB
```

### Estimated Downtime: Zero

Each phase has a rollback plan. No breaking changes to API contracts.

## Conflict Resolution

### Problem: Concurrent Writes

Two indexers in different regions process the same `tx_hash` simultaneously:
- Indexer (us-east-1) writes: `amount = "100"`, `ts = "2026-08-25T10:00:00Z"`
- Indexer (eu-west-1) writes: `amount = "100"`, `ts = "2026-08-25T10:00:01Z"` (1 second later)

**Which value wins?**

### CockroachDB Solution: Last-Write-Wins (LWW)

```sql
-- Indexer writes with timestamp
UPDATE payments 
SET amount = '100', ts = '2026-08-25T10:00:00Z', updated_at = clock_timestamp()
WHERE tx_hash = 'abc123';

-- CockroachDB uses updated_at as conflict resolution timestamp
-- Later write (10:00:01) wins over earlier write (10:00:00)
```

**Mitigation for Accensa**:
- Sync job is already idempotent (replaying same ledger range is safe)
- Settlement hooks use `ON CONFLICT DO UPDATE` (already LWW semantics)
- **No code changes needed** — current logic is conflict-tolerant

### Causal Consistency

CockroachDB guarantees:
- **Read-your-writes**: If indexer writes payment A, subsequent reads see payment A
- **Monotonic reads**: Once payment A is seen, never see older version
- **Session consistency**: Within same HTTP session, reads are causally ordered

**No distributed transactions needed** for payment indexing (already append-only)

## Schema Changes

### Add Region-Aware Partitioning

```sql
-- Partition payments by asset for geo-locality
ALTER TABLE payments 
  PARTITION BY LIST (asset) (
    PARTITION us VALUES IN ('native', 'USDC:GA5...'), -- North America assets
    PARTITION eu VALUES IN ('EURC:GB7...'),           -- Europe assets
    PARTITION asia VALUES IN (DEFAULT)                -- Asia assets
  );

-- Add updated_at for conflict resolution
ALTER TABLE payments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT clock_timestamp();
```

### Connection Pooling

Replace Supabase session pooler with CockroachDB-compatible pool:
```typescript
// apps/web/src/lib/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.COCKROACHDB_URL,
  max: 20, // Connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: { rejectUnauthorized: false } // CockroachDB requires SSL
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
```

## Deployment Plan

### Week 1: CockroachDB Cluster Setup
- [ ] Provision CockroachDB Cloud cluster (3 regions, 9 nodes)
- [ ] Replicate schema from Supabase
- [ ] Set up monitoring (Grafana dashboard)
- [ ] Load test: Verify 1000 TPS write throughput

### Week 2: Dual-Write Implementation
- [ ] Modify indexer to write to both databases
- [ ] Add consistency checker (compare rows)
- [ ] Deploy to production
- [ ] Monitor for 1 week, log discrepancies

### Week 3: Read Migration
- [ ] Deploy Vercel edge functions in eu-west-1, ap-south-1
- [ ] Add geo-routing (Vercel Edge Config)
- [ ] Flip reads to CockroachDB
- [ ] Measure latency: Target <100ms p99 globally

### Week 4: Write Cut-Over
- [ ] Make CockroachDB primary
- [ ] Disable Supabase writes
- [ ] Monitor for 24 hours
- [ ] Decommission Supabase if stable

### Week 5: Performance Tuning
- [ ] Add secondary indexes for common queries
- [ ] Tune replication lag (target <10ms)
- [ ] Optimize query plans
- [ ] Load test at 10x current traffic

## Performance Targets

### Latency
- **Current (Supabase us-east-1)**:
  - us-east: 50ms p99
  - eu-west: 300ms p99
  - ap-south: 500ms p99

- **Target (CockroachDB Multi-Region)**:
  - us-east: 80ms p99 (slight increase due to consensus)
  - eu-west: 90ms p99 (10x improvement)
  - ap-south: 95ms p99 (5x improvement)

### Throughput
- Current: ~100 writes/sec (single region)
- Target: ~500 writes/sec (distributed across 3 regions)

### Availability
- Current: 99.9% (Supabase SLA)
- Target: 99.99% (CockroachDB SLA with multi-region)

## Cost Analysis

### Current (Supabase PostgreSQL)
- Database: $25/month (Pro plan, us-east-1)
- Total: $25/month

### Proposed (CockroachDB Multi-Region)
- CockroachDB Cluster: $360/month (9 nodes @ $0.50/hour each)
- Vercel Edge Functions: $20/month (eu-west-1, ap-south-1)
- Total: $380/month

**Cost Increase**: $355/month (~14x)

**Justification**: Unlocks global merchant base, improves latency 5-10x, eliminates single point of failure

## Risks and Mitigations

### Risk 1: Write Conflicts
**Mitigation**: Sync job is idempotent, LWW is acceptable for payment indexing

### Risk 2: Replication Lag
**Mitigation**: CockroachDB consensus <10ms p99, monitor lag metrics

### Risk 3: Migration Data Loss
**Mitigation**: Dual-write period with consistency checker, rollback plan

### Risk 4: Cost Overrun
**Mitigation**: Start with smaller node sizes, scale up based on traffic

### Risk 5: Vendor Lock-In
**Mitigation**: CockroachDB is PostgreSQL-compatible, can migrate to self-hosted

## Success Metrics

- [ ] Global latency <100ms p99 for all dashboard queries
- [ ] Zero data loss during migration
- [ ] 99.99% uptime over 90 days
- [ ] Write throughput ≥500 TPS
- [ ] Replication lag <10ms p99
- [ ] Zero conflict resolution errors in production

## Alternative: PostgreSQL with Read Replicas

**Cheaper option** (~$100/month):
- Master in us-east-1 (writes)
- Read replicas in eu-west-1, ap-south-1
- Geo-route reads to nearest replica

**Trade-offs**:
- Writes still go to us-east-1 (high latency for global merchants)
- Read-only replicas (no active-active)
- Replication lag 1-5 seconds (eventual consistency)

**Verdict**: Acceptable for read-heavy workloads, not for write-heavy indexing

## References

- CockroachDB Multi-Region Docs: https://www.cockroachlabs.com/docs/stable/multiregion-overview.html
- Cloud Spanner Architecture: https://cloud.google.com/spanner/docs/replication
- CockroachDB vs. Spanner: https://www.cockroachlabs.com/compare/cockroachdb-vs-google-cloud-spanner/
