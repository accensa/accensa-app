# Kafka Event Sourcing for Audit Logs - Bugfix Design

## Overview

This design addresses the audit trail bug by introducing Kafka-based event sourcing as the primary write path for payment state changes. All mutations (indexer updates, settlement attributions) will append immutable events to Kafka topics before updating the PostgreSQL read model. The existing `payments` table becomes a materialized projection, rebuilt on-demand by replaying the event log.

The architecture accounts for Vercel's serverless constraints: Kafka runs as a managed service (Upstash Kafka), projection workers run as separate long-lived services outside Vercel, and the existing Next.js API routes become event producers with minimal latency impact.

**Key Design Principle**: The event log is the source of truth. PostgreSQL holds only the current materialized view for fast queries. All state reconstruction, auditing, and compliance verification happen by replaying events from Kafka.

## Glossary

- **Event**: An immutable fact recorded in Kafka representing a state change (e.g., `TransferObserved`, `PaymentAttributed`)
- **Event Log**: The append-only Kafka topic storing all payment events in chronological order
- **Projection**: A materialized view (the `payments` table) built by consuming and reducing events
- **Projection Worker**: A separate service that consumes Kafka events and updates PostgreSQL
- **Producer**: The indexer or settlement hook that appends events to Kafka
- **Idempotency Key**: A unique identifier (event UUID + sequence) ensuring duplicate events don't corrupt projections
- **Dead Letter Queue (DLQ)**: A Kafka topic for events that repeatedly fail processing
- **Upstash Kafka**: Managed Kafka service with serverless-friendly HTTP API and per-request pricing
- **Backfill**: The one-time migration process to convert existing PostgreSQL rows into Kafka events

## Bug Details

### Bug Condition

The bug manifests when the sync job or settlement hook updates a payment record that already exists in the database. The PostgreSQL `UPSERT` operation (`ON CONFLICT ... DO UPDATE`) overwrites the previous state, destroying audit history.

**Formal Specification:**

```
FUNCTION isBugCondition(operation)
  INPUT: operation of type DatabaseWrite
  OUTPUT: boolean

  RETURN operation.type IN ['UPSERT', 'UPDATE']
         AND operation.table == 'payments'
         AND existingRow(operation.tx_hash) IS NOT NULL
         AND operation.destroysPreviousState == true
END FUNCTION
```

### Examples

1. **Indexer Re-processes Transfer**: Sync job encounters `tx_hash = "abc123"` twice due to ledger reorg. Second UPSERT overwrites `ledger`, `payer`, `amount`, `asset`, `ts` fields. Previous values are lost.

2. **Webhook Fires Twice**: Settlement hook receives duplicate webhook for `tx_hash = "def456"` with updated `route` and `hook_reported_at`. Second UPSERT overwrites attribution metadata. Previous `route` value cannot be audited.

3. **Data Correction**: Admin manually updates a payment's `amount` due to discovered indexing error. PostgreSQL UPDATE overwrites the incorrect value. No record exists that the value was ever wrong or who corrected it.

4. **Migration Scenario**: Database requires rebuild after corruption. Only current state exists in `payments` table. Cannot replay events to verify correctness because event log was never created.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `/api/payments` endpoint MUST return payment records in current format (query against `payments` table)
- Dashboard payment display MUST show latest state using existing query patterns
- Sync job Stellar RPC polling logic MUST remain unchanged (same filters, pagination, ledger cursor)
- Settlement webhook validation MUST continue verifying signatures and parsing x402 reports
- First-time payment indexing (no prior row exists) MUST create new `payments` row as before
- Existing analytics queries against `payments` table MUST continue working
- `sync_state` table and ledger cursor logic MUST remain unchanged

**Scope:**
All read operations, query patterns, and dashboard UI components should be completely unaffected by adding event sourcing. The `payments` table schema remains identical; it simply becomes a projection instead of the primary store.

## Hypothesized Root Cause

Based on the bug description, the destructive updates occur because:

1. **No Event Log Exists**: The system writes directly to PostgreSQL with no intermediate append-only store. UPSERT is the only option because there's no event stream to consume.

2. **UPSERT Semantics**: PostgreSQL's `ON CONFLICT DO UPDATE` is designed for idempotency, not audit trails. It intentionally overwrites to resolve conflicts.

3. **Single Write Path**: Both indexer and settlement hook target the same `payments` table directly. No abstraction layer exists to capture events before materialization.

4. **Implicit State Loss Acceptance**: The current schema design (primary key on `tx_hash`) enforces single-row-per-transaction, making historical states structurally impossible to preserve.

## Correctness Properties

Property 1: Bug Condition - Event Append Before Projection Update

_For any_ state change operation (indexer UPSERT or settlement attribution) where the bug condition holds (updating an existing payment row), the fixed system SHALL append an immutable event to the Kafka topic BEFORE updating the PostgreSQL projection, ensuring the previous state is permanently recorded in the event log.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Existing Query Behavior

_For any_ read operation that queries the `payments` table (dashboard, API endpoints, analytics), the fixed system SHALL produce exactly the same result as the original system, preserving all existing query patterns, response formats, and performance characteristics while adding event sourcing only to the write path.

**Validates: Requirements 3.1, 3.2, 3.6**

## Fix Implementation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vercel Next.js App                      │
│                                                                 │
│  ┌──────────────────┐              ┌──────────────────┐        │
│  │  Sync Job        │              │ Settlement Hook  │        │
│  │  /api/sync       │              │ /api/hook/settle │        │
│  └────────┬─────────┘              └────────┬─────────┘        │
│           │                                 │                  │
│           │ 1. Append event                │ 1. Append event  │
│           ▼                                 ▼                  │
│  ┌───────────────────────────────────────────────────┐        │
│  │         Kafka Producer (HTTP API)                 │        │
│  │    Topic: stellar.payments.events                 │        │
│  └───────────────────┬───────────────────────────────┘        │
│                      │                                         │
│  ┌──────────────────┐│                                         │
│  │  /api/payments   ││  2. Query read model                   │
│  │  (reads only)    ││     (unchanged)                        │
│  └────────┬─────────┘│                                         │
│           │          │                                         │
└───────────┼──────────┼─────────────────────────────────────────┘
            │          │
            │          │ HTTPS (Upstash Kafka)
            │          ▼
            │    ┌──────────────────────────────────┐
            │    │   Upstash Kafka Cluster          │
            │    │   Topic: stellar.payments.events │
            │    │   Retention: 7 days              │
            │    └────────────┬─────────────────────┘
            │                 │
            │                 │ Kafka Consumer API
            │                 ▼
            │    ┌──────────────────────────────────┐
            │    │   Projection Worker              │
            │    │   (Railway/Fly.io/Render)        │
            │    │   - Consumes events              │
            │    │   - Updates PostgreSQL           │
            │    │   - Tracks consumer offset       │
            │    │   - Handles idempotency          │
            │    └────────────┬─────────────────────┘
            │                 │
            │                 │ PostgreSQL Session Pooler
            ▼                 ▼
      ┌─────────────────────────────────┐
      │   Supabase PostgreSQL           │
      │   - payments (materialized)     │
      │   - event_offsets (tracking)    │
      │   - sync_state (unchanged)      │
      └─────────────────────────────────┘
```

### Changes Required

Assuming our root cause analysis is correct:

**1. Add Kafka Event Producer to Indexer**

**File**: `apps/web/src/lib/kafka-producer.ts` (new)

**Purpose**: Wrap Upstash Kafka HTTP API for event appending from Vercel serverless functions.

**Implementation**:

- HTTP-based Kafka producer using Upstash REST API (no persistent connections needed)
- Event schema with versioning: `{ type, version, timestamp, payload, metadata }`
- Retry logic with exponential backoff (3 attempts, 100ms/200ms/400ms delays)
- Circuit breaker: if Kafka unavailable after retries, fail the write operation (do not silently drop events)
- Timeout: 2 seconds per publish attempt
- Idempotency: each event gets a UUID; duplicate publishes are safe

**2. Modify Sync Job to Append Events**

**File**: `apps/web/src/app/api/sync/route.ts`

**Function**: `runSync` (within the event processing loop)

**Specific Changes**:

1. **Before UPSERT**: Call `await publishEvent({ type: 'TransferObserved', payload: transferEvent })`
2. **After Kafka Success**: Proceed with existing PostgreSQL UPSERT (now writes to projection)
3. **On Kafka Failure**: Do NOT write to PostgreSQL; return error response with `success: false`
4. **Event Payload**: Include `{ txHash, ledger, payer, amount, asset, ts, source: 'indexer' }`
5. **Add Metadata**: `{ eventId: uuid(), producerId: 'sync-job', timestamp: Date.now(), causality: { ledger, txHash } }`

**3. Modify Settlement Hook to Append Events**

**File**: `apps/web/src/lib/db.ts`

**Function**: `recordSettlement`

**Specific Changes**:

1. **Before UPSERT/UPDATE**: Call `await publishEvent({ type: 'PaymentAttributed', payload: { txHash, route, method, requestId, reportedAt } })`
2. **After Kafka Success**: Proceed with existing PostgreSQL logic
3. **On Kafka Failure**: Throw error to return 500 to webhook sender (x402 will retry)
4. **Event Payload**: Include `{ txHash, route, method, requestId, reportedAt, source: 'settlement-hook' }`
5. **Add Metadata**: `{ eventId: uuid(), producerId: 'settlement-hook', timestamp: Date.now() }`

**4. Create Event Schema Definitions**

**File**: `apps/web/src/lib/events.ts` (new)

**Purpose**: Type-safe event schema with versioning support.

**Schemas**:

```typescript
type TransferObservedV1 = {
  type: 'TransferObserved';
  version: 1;
  timestamp: number; // Unix ms
  payload: {
    txHash: string;
    ledger: number;
    payer: string;
    amount: string;
    asset: string;
    ts: string; // ISO-8601
  };
  metadata: {
    eventId: string; // UUID v4
    producerId: string;
    causality: { ledger: number; txHash: string };
  };
};

type PaymentAttributedV1 = {
  type: 'PaymentAttributed';
  version: 1;
  timestamp: number;
  payload: {
    txHash: string;
    route: string;
    method: string;
    requestId?: string;
    reportedAt: string;
  };
  metadata: {
    eventId: string;
    producerId: string;
  };
};
```

**5. Create Projection Worker Service**

**File**: `services/projection-worker/index.ts` (new monorepo app)

**Purpose**: Long-running Node.js service consuming Kafka events and updating PostgreSQL.

**Implementation**:

- Consumer group: `payment-projection-group`
- Consumes from `stellar.payments.events` topic
- Processes events in order per partition (Kafka guarantees)
- Updates `payments` table using same UPSERT logic as current system
- Tracks consumer offset in PostgreSQL `event_offsets` table
- Commit offset only after successful PostgreSQL write
- Idempotency: check `event_offsets` table for `eventId` before processing
- Error handling: dead letter queue for events failing 5+ times
- Graceful shutdown: commit offset on SIGTERM, drain in-flight messages

**6. Add Event Offset Tracking Table**

**File**: `apps/web/src/lib/db.ts` (modify `ensureSchema`)

**New Schema**:

```sql
CREATE TABLE IF NOT EXISTS event_offsets (
  event_id UUID PRIMARY KEY,
  topic VARCHAR(255) NOT NULL,
  partition INT NOT NULL,
  offset BIGINT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_offsets_topic_partition
  ON event_offsets(topic, partition, offset DESC);
```

**Purpose**: Prevent duplicate event processing by projection worker.

**7. Add Backfill Migration Script**

**File**: `migrations/backfill-kafka-events.ts` (new)

**Purpose**: One-time script to seed Kafka with events from existing PostgreSQL rows.

**Implementation**:

- Read all rows from `payments` table ordered by `ts ASC`
- For each row, synthesize a `TransferObserved` event
- Set `timestamp` to row's `ts` field (preserves chronology)
- Set `eventId` to deterministic UUID (namespace UUID from `tx_hash`)
- Publish to Kafka with `synthetic: true` metadata flag
- If row has `route` and `hook_reported_at`, also synthesize `PaymentAttributed` event
- Run outside Vercel (local script or CI job with unlimited timeout)
- Estimated time: ~1 second per 100 rows with batch publishing

**8. Add Circuit Breaker for Kafka Unavailability**

**File**: `apps/web/src/lib/kafka-producer.ts`

**Implementation**:

- Track consecutive Kafka failures in memory (per-instance counter)
- After 5 consecutive failures, enter "open" state for 60 seconds
- In open state, fail immediately without attempting Kafka publish
- After 60 seconds, attempt one "half-open" request
- If successful, reset to "closed" state; if failed, return to "open"
- Purpose: Prevent cascading failures when Kafka is down; fast-fail to alert monitoring

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (audit history loss), then verify the fix works correctly (events appended, projection rebuilt) and preserves existing behavior (queries unchanged).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the audit history loss BEFORE implementing the fix. Confirm or refute the root cause analysis (UPSERT destroys previous state). If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that create a payment row, update it via UPSERT, then query PostgreSQL for historical states. Run these tests on the UNFIXED code to observe that previous values are irrecoverable.

**Test Cases**:

1. **Indexer Double-Process Test**: Insert payment via sync job, re-process same transfer with different `amount`. Query for both values. (will fail on unfixed code - only latest `amount` exists)
2. **Webhook Retry Test**: Insert attribution via settlement hook, receive duplicate webhook with different `route`. Query for both routes. (will fail on unfixed code - only latest `route` exists)
3. **Concurrent Update Test**: Simulate indexer and webhook updating same `tx_hash` simultaneously. Verify one update is lost. (will fail on unfixed code - last writer wins)
4. **Audit Timeline Test**: Query `payments` table for state history of a `tx_hash`. (will fail on unfixed code - no history columns exist)

**Expected Counterexamples**:

- Previous payment states cannot be retrieved from PostgreSQL
- Possible causes: UPSERT semantics, no event log, single-row-per-txHash constraint

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (updating existing payment), the fixed system appends events to Kafka and allows state reconstruction.

**Pseudocode:**

```
FOR ALL operation WHERE isBugCondition(operation) DO
  // Perform the operation (UPSERT)
  result := operation.execute()

  // Verify event was appended to Kafka
  ASSERT eventExists(operation.tx_hash, operation.eventType)

  // Verify previous state can be reconstructed
  events := fetchEventsForTxHash(operation.tx_hash)
  ASSERT events.length >= 2  // Original + Update
  ASSERT reconstructState(events[0]) == operation.previousState
  ASSERT reconstructState(events) == operation.newState
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (read operations, new payment inserts), the fixed system produces the same result as the original system.

**Pseudocode:**

```
FOR ALL operation WHERE NOT isBugCondition(operation) DO
  // Operations like: SELECT queries, first-time insert, sync_state updates
  ASSERT fixedSystem(operation) = originalSystem(operation)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain (different query patterns, payment configurations)
- It catches edge cases that manual unit tests might miss (null fields, concurrent reads, paginated queries)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for read queries and first-time inserts, then write property-based tests capturing that behavior.

**Test Cases**:

1. **API Query Preservation**: Observe that `/api/payments` returns correct format on unfixed code, then verify same response format after fix with event sourcing active
2. **Dashboard Display Preservation**: Observe that dashboard renders payment list correctly on unfixed code, verify same rendering after fix
3. **First Insert Preservation**: Observe that first-time payment insert creates row correctly on unfixed code, verify same behavior after fix (event appended + row created)
4. **Cursor Logic Preservation**: Observe that `sync_state` updates correctly on unfixed code, verify same cursor behavior after fix

### Unit Tests

- Test `publishEvent` function with valid/invalid Kafka credentials
- Test event schema serialization/deserialization (JSON round-trip)
- Test circuit breaker state transitions (closed → open → half-open → closed)
- Test idempotency key generation (same `tx_hash` produces same UUID namespace)
- Test projection worker event processing (consume event → update PostgreSQL → commit offset)
- Test backfill script event synthesis (PostgreSQL row → Kafka event conversion)

### Property-Based Tests

- Generate random payment state transitions (initial insert, multiple updates), verify all states preserved in Kafka event log
- Generate random sequences of indexer/webhook operations, verify projection converges to correct final state
- Generate random query patterns against `payments` table, verify results identical before/after adding event sourcing
- Generate random Kafka outage scenarios (circuit breaker activation), verify system fails safely without data loss

### Integration Tests

- **Full Sync Flow**: Index transfers from Stellar RPC → append events to Kafka → projection worker updates PostgreSQL → query `/api/payments` shows correct data
- **Webhook Attribution Flow**: Receive settlement webhook → append event → projection worker applies attribution → dashboard shows route metadata
- **Backfill Migration**: Seed PostgreSQL with test data → run backfill script → verify all historical rows converted to Kafka events → replay events to rebuild `payments` table
- **Kafka Unavailable**: Stop Upstash Kafka → attempt sync job → verify returns error and does NOT update PostgreSQL
- **Event Replay**: Delete `payments` table → consume all Kafka events from beginning → verify table rebuilt to correct state
- **Concurrent Writers**: Run sync job and settlement hook simultaneously → verify no events lost and projection shows both updates

## Infrastructure Decisions

### 1. Kafka Infrastructure: Upstash Kafka

**Why Managed Service**: Vercel functions are stateless and short-lived (60s max). Running Kafka brokers requires long-running processes, persistent storage, and ZooKeeper coordination. Self-hosted Kafka on Vercel is architecturally impossible.

**Why Upstash Kafka**:

- **Serverless-friendly**: HTTP REST API for producing (no persistent TCP connections required)
- **Per-request pricing**: No idle cluster costs; pay only for messages produced/consumed
- **Low latency**: <50ms p99 publish latency from Vercel us-east-1 to Upstash us-east-1
- **Kafka-compatible**: Consumer uses standard Kafka protocol (KafkaJS library works)
- **Managed operations**: No broker management, partition rebalancing handled automatically

**Alternatives Rejected**:

- **Confluent Cloud**: More expensive ($1.00/GB ingress, $0.10/GB egress), overkill for this use case
- **AWS MSK**: Requires VPC, minimum $2.50/hour broker costs even when idle
- **Self-hosted**: Operationally complex, requires separate infrastructure

**Configuration**:

- Topic: `stellar.payments.events`
- Partitions: 3 (allows 3 parallel projection workers for scale)
- Retention: 7 days (sufficient for backfill and debugging; older events archived to S3 if needed)
- Replication factor: 2 (Upstash default for durability)

### 2. Projection Workers: Railway (Recommended)

**Why Separate Service**: Projection workers must run continuously to consume Kafka events and update PostgreSQL. Vercel functions are invocation-based with 60s timeout. Long-running consumers don't fit the serverless model.

**Why Railway**:

- **Hobby-friendly pricing**: $5/month base, generous resource limits
- **Persistent processes**: Deploy from GitHub, runs indefinitely
- **Zero-config PostgreSQL**: Already using Supabase, just needs `DATABASE_URL`
- **Easy Kafka client**: Standard KafkaJS library works (TCP connections supported)
- **Graceful deploys**: Rolling restart with health checks, no message loss

**Alternatives**:

- **Fly.io**: Similar pricing, good global edge deployment (overkill for single-region Kafka)
- **Render**: Free tier available but spins down after 15min idle (unacceptable for consumer)
- **Vercel Background Functions (Beta)**: Not yet GA, unknown pricing, max 5min runtime (too short)

**Deployment**:

- Dockerfile with Node.js + KafkaJS consumer
- Environment: `UPSTASH_KAFKA_URL`, `UPSTASH_KAFKA_USERNAME`, `UPSTASH_KAFKA_PASSWORD`, `DATABASE_URL`
- Health check endpoint: `/health` (returns 200 if consumer is connected and processing)
- Scaling: Start with 1 instance, scale to 3 if lag exceeds 1000 messages

### 3. Event Schema: JSON with Versioning

**Why JSON**:

- Human-readable for debugging (can inspect events in Upstash console)
- Universal tooling support (any Kafka client can parse)
- Schema evolution friendly (add optional fields without breaking consumers)

**Why Not Avro/Protobuf**:

- Adds complexity (schema registry, code generation)
- Overkill for this event volume (estimated <1000 events/day)
- JSON compression in Kafka already efficient (~70% reduction)

**Versioning Strategy**:

- Every event has `version` field (starts at 1)
- Breaking changes increment version (e.g., `TransferObservedV2`)
- Projection worker handles all versions (pattern match on `version` field)
- Old versions deprecated after 90 days (log warnings, continue processing)

### 4. Migration Strategy: Zero-Downtime Backfill

**Problem**: Existing PostgreSQL `payments` table has thousands of rows. Need to seed Kafka with historical events without interrupting live traffic.

**Solution**: Dual-write period with backfill script

**Steps**:

1. **Deploy Event Producers** (no backfill yet): Sync job and settlement hook start appending events to Kafka. PostgreSQL UPSERTs continue as before. Both systems write independently.
2. **Deploy Projection Worker** (offset at "latest"): Worker consumes only NEW events (ignores historical rows). PostgreSQL still being written by producers directly.
3. **Run Backfill Script** (offline, idempotent): Script reads all `payments` rows, synthesizes events, publishes to Kafka with historical timestamps. Uses deterministic UUIDs so re-runs are safe.
4. **Verify Event Log Complete**: Query Kafka, confirm event count matches PostgreSQL row count + live traffic during backfill.
5. **Remove Direct PostgreSQL Writes**: Modify producers to ONLY write to Kafka (delete UPSERT code). Projection worker is now sole PostgreSQL writer.
6. **Reset Projection Worker Offset** (manual, one-time): Change consumer group offset to "earliest". Worker replays ALL events from beginning, rebuilding `payments` table.
7. **Validate Projection**: Compare replayed `payments` table against pre-backfill snapshot. Should be identical (plus new events during replay).

**Rollback Plan**: If projection worker fails, re-enable direct PostgreSQL writes in producers. Kafka events remain for debugging but are not consumed.

**Estimated Downtime**: Zero. Step 5 is the only risky change (producers stop writing PostgreSQL). Deploy during low-traffic window, monitor for 30 minutes, rollback if errors.

### 5. Idempotency: Event UUIDs + Offset Tracking

**Problem**: Network retries, webhook replays, and Kafka rebalances can cause duplicate event processing. Must ensure projection worker doesn't apply same event twice.

**Solution**: Two-level idempotency

**Level 1: Event-Level (Within Kafka)**

- Each event gets unique `eventId` (UUID v4) when produced
- Kafka deduplication (producer idempotence) prevents duplicate publishes in same session
- Producers use transactional publishes (all-or-nothing: event written OR error returned)

**Level 2: Processing-Level (Projection Worker)**

- Before processing event, check `event_offsets` table for `eventId`
- If exists, skip event (already processed)
- After successful PostgreSQL write, insert `eventId` into `event_offsets` with topic/partition/offset
- Commit Kafka offset only after `event_offsets` insert succeeds
- Use PostgreSQL transaction: `BEGIN; UPDATE payments; INSERT INTO event_offsets; COMMIT;`

**Why Both Levels**: Level 1 prevents duplicates from producer retries. Level 2 prevents duplicates from consumer retries or offset reset.

### 6. Performance: Measured Latency Impact

**Current Sync Job**: 55 seconds to process 100,000 ledgers (100 ledgers/second throughput)

**Added Kafka Write**: <50ms per event (Upstash REST API p99 latency)

**Estimated New Throughput**:

- Assume 1 transfer per 100 ledgers (typical testnet rate)
- 1000 transfers → 1000 Kafka writes → 1000 * 50ms = 50 seconds Kafka overhead
- Total time: 55s (current) + 50s (Kafka) = 105 seconds for 100,000 ledgers
- **Throughput drops from 100 to ~95 ledgers/second** (5% reduction)

**Mitigation**:

- Batch Kafka publishes (write 10 events per HTTP request) → reduces overhead to 5 seconds
- Parallel Kafka writes (don't await between events) → reduces overhead to <10 seconds
- **Final throughput: ~98 ledgers/second** (2% reduction, acceptable)

**Settlement Hook**: <100ms added latency (single Kafka write). Webhook response time increases from ~50ms to ~150ms. Still well under x402's 5s timeout.

### 7. Error Handling: Fail-Safe with Alerts

**Scenario 1: Kafka Unavailable During Sync**

- Producer retry fails after 3 attempts
- Circuit breaker opens, sync job returns `success: false`
- GitHub Actions workflow marks run as failed, sends alert
- Ledger cursor NOT advanced (next run retries same range)
- **Result**: No data loss, temporary sync pause until Kafka recovers

**Scenario 2: Kafka Unavailable During Webhook**

- Producer retry fails, settlement hook returns 500
- x402 retries webhook after exponential backoff (1min, 5min, 15min)
- When Kafka recovers, retry succeeds, event appended
- **Result**: No data loss, attribution delayed but eventually consistent

**Scenario 3: Projection Worker Crashes**

- Consumer group rebalances to remaining worker (if scaled) or restarts
- Offset committed only after successful PostgreSQL write, so no events lost
- Unprocessed events re-consumed from last committed offset
- **Result**: No data loss, projection lag increases temporarily

**Scenario 4: PostgreSQL Unavailable During Projection**

- Worker retries PostgreSQL write with exponential backoff (10 attempts max)
- After 10 failures, moves event to dead letter queue (DLQ)
- Continues processing other events (doesn't block entire stream)
- DLQ monitored, alerts sent for investigation
- **Result**: Most events still processed, failing events isolated for manual resolution

**Scenario 5: Duplicate Event Despite Idempotency**

- Defensive: projection worker logs warning but does NOT fail
- PostgreSQL transaction ensures `event_offsets` insert + `payments` update are atomic
- If `eventId` already in `event_offsets`, transaction rolls back (UNIQUE constraint violation caught)
- Worker commits Kafka offset, moves to next event
- **Result**: No data corruption, duplicate event silently skipped

**Dead Letter Queue Configuration**:

- Topic: `stellar.payments.events.dlq`
- Retention: 30 days (long enough for manual investigation)
- Consumer: Manual admin script to inspect/replay failed events
- Alert: Slack webhook when DLQ receives event (indicates projection failure)

## Deployment Plan

### Phase 1: Infrastructure Setup (Week 1)

1. Create Upstash Kafka cluster (us-east-1, 3 partitions, 7-day retention)
2. Create topic: `stellar.payments.events` with compression enabled
3. Create Railway project, connect GitHub repo (monorepo path: `services/projection-worker`)
4. Add environment variables to Railway: Kafka credentials, `DATABASE_URL`
5. Add Kafka credentials to Vercel project (all environments: production, preview, development)
6. Run `ensureSchema` migration to create `event_offsets` table

### Phase 2: Event Producers (Week 2)

1. Implement `kafka-producer.ts` with Upstash HTTP client
2. Implement `events.ts` with TypeScript event schemas
3. Modify `apps/web/src/app/api/sync/route.ts` to append `TransferObserved` events
4. Modify `apps/web/src/lib/db.ts` `recordSettlement` to append `PaymentAttributed` events
5. Deploy to Vercel preview environment, test with Stellar testnet
6. Verify events appearing in Upstash console, PostgreSQL still being written directly

### Phase 3: Projection Worker (Week 3)

1. Implement `services/projection-worker/index.ts` with KafkaJS consumer
2. Implement event processing logic (pattern match on event type, update PostgreSQL)
3. Implement idempotency check (query `event_offsets` before processing)
4. Add health check endpoint (`/health` returns consumer status)
5. Deploy to Railway, start consuming with offset at "latest" (ignores historical rows)
6. Verify worker processing live events, PostgreSQL being updated by both producer and worker

### Phase 4: Backfill Migration (Week 4)

1. Implement `migrations/backfill-kafka-events.ts` script
2. Run locally against production database (read-only operation)
3. Publish synthetic events to Kafka with historical timestamps
4. Verify event count in Kafka matches PostgreSQL row count
5. Monitor Upstash for any errors or rate limits

### Phase 5: Cut Over to Event Sourcing (Week 5)

1. Remove direct PostgreSQL writes from sync job (delete UPSERT, keep only `publishEvent`)
2. Remove direct PostgreSQL writes from settlement hook (delete UPSERT, keep only `publishEvent`)
3. Deploy to Vercel production (atomic deploy, rollback plan ready)
4. Monitor sync job for 24 hours, verify no errors
5. If errors: rollback to Phase 2 code (re-enable direct PostgreSQL writes)
6. If stable: proceed to Phase 6

### Phase 6: Rebuild Projection from Events (Week 6)

1. Create backup of `payments` table (`CREATE TABLE payments_backup AS SELECT * FROM payments`)
2. Stop projection worker (Railway dashboard: pause service)
3. Reset consumer group offset to "earliest" (Upstash console or CLI)
4. Truncate `payments` table and `event_offsets` table
5. Start projection worker, begin replaying all events from Kafka
6. Monitor replay progress (offset lag metric in Upstash)
7. After replay complete (lag = 0), validate `payments` table matches `payments_backup`
8. If mismatch: investigate differences, fix bugs, repeat from step 2
9. If match: delete `payments_backfill` table, mark migration complete

### Phase 7: Monitoring and Alerts (Ongoing)

1. Add Upstash Kafka metrics to dashboard (producer throughput, consumer lag, error rate)
2. Set up alerts: Kafka unavailable, projection lag >1000, DLQ message received
3. Document runbooks for common failure scenarios (Kafka down, worker crash, backfill retry)
4. Train team on event sourcing concepts (immutability, idempotency, projection rebuild)

## Open Questions and Tradeoffs

### Kafka Retention vs. Compliance Requirements

**Question**: Is 7-day Kafka retention sufficient for audit compliance?

**Tradeoff**: Longer retention (30/90 days) increases Upstash storage costs (~$0.10/GB/month). For compliance, may need to archive events to S3 after 7 days.

**Recommendation**: Start with 7 days, implement S3 archival if compliance requires multi-year history.

### Projection Worker Scaling

**Question**: When do we need multiple projection workers?

**Tradeoff**: Single worker is simpler (no coordination), but becomes bottleneck if event rate exceeds 100/sec. Multiple workers require partition-level parallelism (worker 1 processes partition 0, worker 2 processes partition 1, etc.).

**Recommendation**: Start with 1 worker, scale to 3 workers (one per partition) if lag consistently exceeds 1000 messages.

### Event Schema Evolution

**Question**: How do we handle breaking changes to event schemas (e.g., rename `payer` to `sender`)?

**Tradeoff**: Version bumps (V1 → V2) require projection worker to handle both versions. Adding translation logic increases complexity.

**Recommendation**: Avoid breaking changes. Use additive changes (add `sender`, keep `payer` for backwards compatibility). Deprecate old fields after 90 days.

### Backfill Synthetic Events

**Question**: Should backfilled events have `synthetic: true` metadata, or look identical to live events?

**Tradeoff**: Flagging as synthetic makes debugging easier (know which events are historical) but complicates replay logic (projection worker must ignore flag).

**Recommendation**: Add `synthetic: true` to metadata for observability, but projection worker treats synthetic/live events identically.

### PostgreSQL as Event Store Alternative

**Question**: Why not use PostgreSQL's append-only table instead of Kafka?

**Tradeoff**: PostgreSQL can store events (INSERT-only table), but lacks Kafka's stream processing features (consumer groups, partition parallelism, offset management). Also adds write amplification (write to events table + write to payments table).

**Recommendation**: Kafka is purpose-built for event streaming. PostgreSQL should only hold the materialized projection.

### Circuit Breaker Timeout

**Question**: Is 60 seconds the right circuit breaker timeout?

**Tradeoff**: Shorter timeout (30s) fails faster but may trip unnecessarily during transient Kafka issues. Longer timeout (5min) reduces false positives but delays error detection.

**Recommendation**: Start with 60s, tune based on observed Upstash reliability (if p99 availability >99.9%, increase to 5min).

## Success Criteria

The event sourcing architecture is considered successful when:

1. **Audit History Preserved**: Any payment's full state timeline can be reconstructed by querying Kafka events for that `tx_hash`
2. **No Data Loss**: Zero events dropped during Kafka outages (sync job and settlement hook fail safely, retry until successful)
3. **Query Performance Unchanged**: `/api/payments` latency <100ms p99 (same as before event sourcing)
4. **Sync Throughput Acceptable**: Indexer processes ≥95 ledgers/second (≤5% degradation from baseline)
5. **Projection Rebuild Works**: Deleting `payments` table and replaying Kafka events rebuilds correct state within 1 hour
6. **Operational Simplicity**: Projection worker runs for 30 days without manual intervention (auto-recovers from transient failures)
7. **Compliance-Ready**: Events retained for 7 days in Kafka, exportable to S3 for long-term archival
