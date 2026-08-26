# Implementation Plan: Kafka Event Sourcing for Audit Logs

## Overview

This implementation plan addresses the audit trail bug by introducing Kafka-based event sourcing. The plan follows the exploratory bugfix workflow: explore the bug with tests, preserve existing behavior, implement the fix with event sourcing, and validate the solution.

---

## Phase 1: Bug Condition Exploration

- [ ] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Audit History Loss on Payment Updates
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples demonstrating that UPSERT operations destroy audit history
  - **Scoped PBT Approach**: Scope properties to concrete failing cases (duplicate indexer processing, webhook retries)

  **Test 1.1: Indexer Double-Process Loses History**
  - Test: Insert payment via sync job with `tx_hash="abc123"`, `amount="100"`
  - Then: Re-process same `tx_hash` with `amount="200"` (simulating ledger reorg)
  - Assert: Query PostgreSQL for both amount values (100 and 200)
  - Expected on UNFIXED code: FAILS - only amount="200" exists, previous value lost
  - From Bug Condition: `isBugCondition(operation)` where `operation.type='UPSERT' AND existingRow(tx_hash) IS NOT NULL`

  **Test 1.2: Webhook Retry Loses Attribution History**
  - Test: Insert settlement attribution with `tx_hash="def456"`, `route="route-v1"`
  - Then: Receive duplicate webhook with `route="route-v2"`, newer timestamp
  - Assert: Query PostgreSQL for both route values (route-v1 and route-v2)
  - Expected on UNFIXED code: FAILS - only route="route-v2" exists, previous attribution lost
  - From Bug Condition: Settlement hook UPSERT destroys previous `route`, `method`, `hook_reported_at` fields

  **Test 1.3: Concurrent Update Loses State**
  - Test: Simulate indexer and webhook updating same `tx_hash` simultaneously
  - Assert: Both updates are preserved in audit trail
  - Expected on UNFIXED code: FAILS - last writer wins, one update is lost
  - From Bug Condition: No event log exists, only final state in PostgreSQL

  **Test 1.4: Audit Timeline Query Fails**
  - Test: Query `payments` table for complete state history of `tx_hash="ghi789"`
  - Assert: Retrieve chronological list of all state changes
  - Expected on UNFIXED code: FAILS - no history columns or audit trail exist
  - From Bug Condition: Single-row-per-txHash constraint makes historical states impossible

  - Run tests on UNFIXED code (before Kafka event sourcing implemented)
  - **EXPECTED OUTCOME**: All tests FAIL (this confirms the bug exists)
  - Document counterexamples found (specific cases where audit history is lost)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

---

## Phase 2: Preservation Property Tests

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Read Operations and Query Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy operations (reads, first-time inserts)
  - Write property-based tests capturing observed behavior patterns
  - Property-based testing generates many test cases for stronger guarantees

  **Test 2.1: API Query Response Format Preserved**
  - Observe: Query `/api/payments` on unfixed code, record response structure
  - Property: For all query parameters, response format matches observed structure
  - Test: Generate random query params (pagination, filters), verify response format unchanged
  - Expected on UNFIXED code: PASSES (establishes baseline)
  - From Preservation Requirements: 3.1 - "/api/payments endpoint MUST return payment records in current format"

  **Test 2.2: Dashboard Display Behavior Preserved**
  - Observe: Dashboard renders payment list correctly on unfixed code
  - Property: For all payment states, dashboard display matches observed behavior
  - Test: Generate random payment data, verify dashboard rendering unchanged
  - Expected on UNFIXED code: PASSES (establishes baseline)
  - From Preservation Requirements: 3.2 - "Dashboard payment display MUST show latest state using existing query patterns"

  **Test 2.3: First-Time Insert Behavior Preserved**
  - Observe: First-time payment insert creates new row correctly on unfixed code
  - Property: For all new `tx_hash` values (no existing row), insert creates row with correct fields
  - Test: Generate random new payments, verify row creation matches observed behavior
  - Expected on UNFIXED code: PASSES (establishes baseline)
  - From Preservation Requirements: 3.5 - "First-time payment indexing MUST create new row in payments table"

  **Test 2.4: Sync State Cursor Preservation**
  - Observe: `sync_state` table updates correctly after sync job on unfixed code
  - Property: For all ledger ranges processed, cursor advances as observed
  - Test: Run sync job with random ledger ranges, verify cursor behavior unchanged
  - Expected on UNFIXED code: PASSES (establishes baseline)
  - From Preservation Requirements: 3.7 - "Sync job MUST update sync_state to record progress"

  **Test 2.5: Analytics Query Compatibility Preserved**
  - Observe: Existing analytics queries against `payments` table work on unfixed code
  - Property: For all SELECT queries, results match observed output
  - Test: Run sample analytics queries, verify results unchanged after adding event sourcing
  - Expected on UNFIXED code: PASSES (establishes baseline)
  - From Preservation Requirements: 3.6 - "Database schema queries MUST support current payments table structure"

  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: All tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

---

## Phase 3: Infrastructure Setup

- [ ] 3. Set up Kafka infrastructure and database schema

  - [ ] 3.1 Create Upstash Kafka cluster
    - Provision cluster in us-east-1 region
    - Create topic: `stellar.payments.events`
    - Configure: 3 partitions, 7-day retention, compression enabled
    - Configure replication factor: 2 (for durability)
    - Create dead letter queue topic: `stellar.payments.events.dlq`
    - Store credentials securely (Vercel environment variables)
    - _Requirements: 2.1, 2.2_

  - [ ] 3.2 Add event offset tracking table to database
    - Run migration to create `event_offsets` table
    - Schema: `event_id UUID PRIMARY KEY, topic VARCHAR(255), partition INT, offset BIGINT, processed_at TIMESTAMPTZ`
    - Add index: `idx_event_offsets_topic_partition` on `(topic, partition, offset DESC)`
    - Purpose: Track processed events for idempotency in projection worker
    - _Requirements: 2.6_

  - [ ] 3.3 Configure Railway project for projection worker
    - Create Railway project, connect to GitHub repo
    - Set monorepo path: `services/projection-worker`
    - Add environment variables: `UPSTASH_KAFKA_URL`, `UPSTASH_KAFKA_USERNAME`, `UPSTASH_KAFKA_PASSWORD`, `DATABASE_URL`
    - Configure health check endpoint: `/health`
    - Set resource limits: 1 CPU, 512MB RAM (initial allocation)
    - _Requirements: 2.6_

  - [ ] 3.4 Add Kafka credentials to Vercel
    - Add environment variables to all Vercel environments (production, preview, development)
    - Variables: `UPSTASH_KAFKA_REST_URL`, `UPSTASH_KAFKA_REST_USERNAME`, `UPSTASH_KAFKA_REST_PASSWORD`
    - Verify variables accessible in Next.js API routes
    - _Requirements: 2.1_

---

## Phase 4: Event Schema and Producer Implementation

- [ ] 4. Implement event schema definitions and Kafka producer

  - [ ] 4.1 Create TypeScript event schema definitions
    - File: `apps/web/src/lib/events.ts` (new)
    - Define `TransferObservedV1` type: `{ type, version, timestamp, payload: { txHash, ledger, payer, amount, asset, ts }, metadata: { eventId, producerId, causality } }`
    - Define `PaymentAttributedV1` type: `{ type, version, timestamp, payload: { txHash, route, method, requestId, reportedAt }, metadata: { eventId, producerId } }`
    - Add type guards for event validation
    - Export union type: `PaymentEvent = TransferObservedV1 | PaymentAttributedV1`
    - _Bug_Condition: Events must capture all fields to enable state reconstruction for C(X) inputs_
    - _Expected_Behavior: Event schemas encode complete state changes as per expectedBehavior(result)_
    - _Preservation: Schema includes all existing payment fields to preserve query compatibility_
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 4.2 Implement Kafka producer wrapper
    - File: `apps/web/src/lib/kafka-producer.ts` (new)
    - Wrap Upstash Kafka HTTP REST API for producing events
    - Function: `publishEvent(event: PaymentEvent): Promise<void>`
    - Implement retry logic: 3 attempts with exponential backoff (100ms, 200ms, 400ms)
    - Implement timeout: 2 seconds per publish attempt
    - Generate UUID v4 for `eventId` field
    - Add request/response logging for debugging
    - _Bug_Condition: Producer must append events before PostgreSQL writes to prevent audit loss_
    - _Expected_Behavior: Events successfully published to Kafka with all required fields_
    - _Preservation: Producer does not modify existing sync/settlement logic flow_
    - _Requirements: 2.1, 2.2_

  - [ ] 4.3 Implement circuit breaker for Kafka availability
    - File: `apps/web/src/lib/kafka-producer.ts` (extend)
    - Track consecutive Kafka failures in memory (per-instance counter)
    - After 5 consecutive failures, enter "open" state for 60 seconds
    - In open state, fail immediately without attempting publish
    - After 60 seconds, attempt one "half-open" request
    - Reset to "closed" on success, return to "open" on failure
    - Purpose: Prevent cascading failures when Kafka unavailable
    - _Bug_Condition: Circuit breaker ensures fail-safe behavior when event log unavailable_
    - _Expected_Behavior: Fast-fail with clear error messaging during Kafka outages_
    - _Preservation: Does not affect existing error handling for non-Kafka failures_
    - _Requirements: 2.1_

---

## Phase 5: Sync Job Modification

- [ ] 5. Modify sync job to append events to Kafka

  - [ ] 5.1 Add event publishing to sync job
    - File: `apps/web/src/app/api/sync/route.ts`
    - Function: `runSync` (within event processing loop)
    - BEFORE existing PostgreSQL UPSERT: Call `await publishEvent({ type: 'TransferObserved', payload: transferEvent })`
    - Payload: `{ txHash, ledger, payer, amount, asset, ts, source: 'indexer' }`
    - Metadata: `{ eventId: uuid(), producerId: 'sync-job', timestamp: Date.now(), causality: { ledger, txHash } }`
    - After Kafka success: Proceed with existing PostgreSQL UPSERT
    - On Kafka failure: Do NOT write to PostgreSQL, return error response with `success: false`
    - Preserve existing sync_state cursor logic
    - _Bug_Condition: isBugCondition(operation) where operation.type='UPSERT' AND existingRow(tx_hash) IS NOT NULL_
    - _Expected_Behavior: For C(X) inputs (duplicate tx_hash), event appended before projection update_
    - _Preservation: First-time inserts (¬C(X)) continue creating new rows as before_
    - _Requirements: 2.1, 2.2, 2.3, 3.3, 3.7_

  - [ ] 5.2 Add error handling for Kafka failures
    - On Kafka publish failure: Log error with transaction details
    - Do NOT advance ledger cursor in `sync_state`
    - Return 500 response to GitHub Actions workflow
    - Workflow marks run as failed, triggers alert
    - Next sync run retries same ledger range
    - Purpose: Ensure no data loss when Kafka unavailable
    - _Bug_Condition: Fail-safe ensures events never silently dropped for C(X) operations_
    - _Expected_Behavior: Sync job pauses safely until Kafka recovers_
    - _Preservation: Existing cursor logic ensures resumption works correctly_
    - _Requirements: 2.1_

  - [ ] 5.3 Add Kafka availability logging and metrics
    - Log Kafka publish latency (p50, p99, p999)
    - Log circuit breaker state transitions
    - Track events published per sync run
    - Export metrics to observability dashboard
    - Purpose: Monitor performance impact and Kafka health
    - _Preservation: Logging does not affect sync throughput or behavior_
    - _Requirements: 2.1_

---

## Phase 6: Settlement Hook Modification

- [ ] 6. Modify settlement hook to append events to Kafka

  - [ ] 6.1 Add event publishing to settlement hook
    - File: `apps/web/src/lib/db.ts`
    - Function: `recordSettlement`
    - BEFORE existing PostgreSQL UPSERT/UPDATE: Call `await publishEvent({ type: 'PaymentAttributed', payload: { txHash, route, method, requestId, reportedAt } })`
    - Metadata: `{ eventId: uuid(), producerId: 'settlement-hook', timestamp: Date.now() }`
    - After Kafka success: Proceed with existing PostgreSQL logic
    - On Kafka failure: Throw error to return 500 to webhook sender
    - x402 will retry webhook after exponential backoff
    - _Bug_Condition: isBugCondition(operation) where operation updates existing hook_reported_at_
    - _Expected_Behavior: For C(X) inputs (duplicate webhook), event appended before attribution update_
    - _Preservation: Webhook validation and signature verification logic unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.4_

  - [ ] 6.2 Add idempotency for webhook retries
    - Check if `eventId` already exists in Kafka (based on deterministic UUID from request_id)
    - If event already published, skip Kafka write but proceed with PostgreSQL update
    - Purpose: Handle x402 webhook retries without duplicate events
    - Ensure PostgreSQL projection remains consistent with event log
    - _Bug_Condition: Prevents double-counting attribution changes for same webhook_
    - _Expected_Behavior: Duplicate webhooks produce single event, correct final state_
    - _Preservation: Webhook idempotency behavior unchanged from user perspective_
    - _Requirements: 2.6_

  - [ ] 6.3 Add error handling for Kafka failures
    - On Kafka publish failure: Log error with webhook details
    - Return 500 status to x402 webhook sender
    - x402 retries with exponential backoff (1min, 5min, 15min)
    - When Kafka recovers, retry succeeds and event appended
    - Purpose: Ensure eventual consistency for settlement attribution
    - _Bug_Condition: Fail-safe ensures attribution events never lost for C(X) operations_
    - _Expected_Behavior: Settlement attribution delayed but eventually consistent_
    - _Preservation: Webhook retry behavior matches x402 expectations_
    - _Requirements: 2.1_

---

## Phase 7: Projection Worker Service

- [ ] 7. Implement projection worker to consume events and update PostgreSQL

  - [ ] 7.1 Create projection worker service scaffold
    - File: `services/projection-worker/index.ts` (new)
    - Initialize KafkaJS consumer with consumer group: `payment-projection-group`
    - Subscribe to topic: `stellar.payments.events`
    - Configure: auto-commit disabled (manual offset management)
    - Add graceful shutdown handler (SIGTERM): commit offset, drain in-flight messages
    - Add health check HTTP server: `/health` endpoint returns consumer status
    - _Requirements: 2.6_

  - [ ] 7.2 Implement event processing logic
    - Pattern match on event type: `TransferObserved` or `PaymentAttributed`
    - For `TransferObserved`: UPSERT `payments` table with transfer data
    - For `PaymentAttributed`: UPDATE `payments` table with settlement attribution
    - Use same SQL logic as current sync job and settlement hook (preserve behavior)
    - Wrap in PostgreSQL transaction: `BEGIN; UPDATE payments; INSERT INTO event_offsets; COMMIT;`
    - _Bug_Condition: Projection worker rebuilds materialized view from event log_
    - _Expected_Behavior: For all events (C(X) and ¬C(X)), projection matches event log state_
    - _Preservation: Final state in payments table matches pre-event-sourcing behavior_
    - _Requirements: 2.5, 2.6, 3.1, 3.2_

  - [ ] 7.3 Implement idempotency checking
    - Before processing event: Query `event_offsets` table for `eventId`
    - If `eventId` exists: Skip event processing (already applied)
    - After successful PostgreSQL write: INSERT `eventId` into `event_offsets` with topic/partition/offset
    - Use UNIQUE constraint on `event_id` column to prevent duplicate inserts
    - Handle constraint violation gracefully (log warning, continue)
    - _Bug_Condition: Idempotency prevents duplicate application of C(X) events_
    - _Expected_Behavior: Duplicate events (network retries, offset reset) produce same projection state_
    - _Preservation: Final payment state consistent regardless of event replay_
    - _Requirements: 2.6_

  - [ ] 7.4 Implement offset commit strategy
    - Commit Kafka offset only AFTER successful PostgreSQL transaction
    - If PostgreSQL write fails: Do NOT commit offset
    - Next consumer restart processes same event again
    - Use transaction: ensures atomicity of (PostgreSQL write + offset insert + Kafka commit)
    - Purpose: Guarantee at-least-once processing semantics
    - _Bug_Condition: Prevents event loss during projection worker failures_
    - _Expected_Behavior: All events eventually processed, no gaps in event log consumption_
    - _Preservation: Projection worker failures do not corrupt payment state_
    - _Requirements: 2.6_

  - [ ] 7.5 Implement dead letter queue for failed events
    - On PostgreSQL write failure: Retry with exponential backoff (10 attempts max)
    - After 10 failures: Publish event to DLQ topic `stellar.payments.events.dlq`
    - Continue processing other events (don't block entire stream)
    - DLQ retention: 30 days
    - Add alert: Slack webhook when DLQ receives event
    - Purpose: Isolate failing events for manual investigation
    - _Bug_Condition: Prevents single bad event from blocking all projection updates_
    - _Expected_Behavior: Most events processed successfully, failures isolated and alerted_
    - _Preservation: Projection worker continues operating during partial failures_
    - _Requirements: 2.6_

  - [ ] 7.6 Deploy projection worker to Railway
    - Create Dockerfile with Node.js + KafkaJS dependencies
    - Configure environment variables from Railway dashboard
    - Deploy from GitHub (automatic on push to main branch)
    - Start consumer with offset at "latest" (ignore historical rows initially)
    - Verify health check endpoint accessible
    - Monitor logs for successful event processing
    - _Requirements: 2.6_

---

## Phase 8: Database Migration and Backfill

- [ ] 8. Migrate existing payment data to Kafka event log

  - [ ] 8.1 Implement backfill migration script
    - File: `migrations/backfill-kafka-events.ts` (new)
    - Read all rows from `payments` table ordered by `ts ASC`
    - For each row: Synthesize `TransferObserved` event
    - Set `timestamp` to row's `ts` field (preserves chronology)
    - Set `eventId` to deterministic UUID (namespace UUID from `tx_hash`)
    - Add metadata flag: `synthetic: true`
    - If row has `route` and `hook_reported_at`: Also synthesize `PaymentAttributed` event
    - Publish events in batches of 100 to Kafka
    - Track progress (rows processed, events published, errors)
    - _Bug_Condition: Backfill seeds event log with historical states for existing payments_
    - _Expected_Behavior: After backfill, all historical payments have corresponding events in Kafka_
    - _Preservation: Backfill does not modify existing payments table rows_
    - _Requirements: 2.5_

  - [ ] 8.2 Run backfill script against production database
    - Run locally or in CI job (no timeout constraints)
    - Use read-only database connection initially (dry-run mode)
    - Verify event count in Kafka matches PostgreSQL row count
    - Monitor Upstash for rate limits or errors
    - Estimated time: ~10 seconds per 1000 rows with batch publishing
    - _Requirements: 2.5_

  - [ ] 8.3 Validate backfill completeness
    - Query Kafka topic: Count total events published
    - Query PostgreSQL: Count total rows in `payments` table
    - Compare counts: Events should be ≥ rows (some rows generate 2 events)
    - Spot-check: Select random `tx_hash`, verify event exists in Kafka
    - Verify event timestamps match row `ts` field
    - _Bug_Condition: Ensures historical audit trail is complete in event log_
    - _Expected_Behavior: All historical payments reconstructable from Kafka events_
    - _Preservation: Existing payments table rows unchanged by backfill_
    - _Requirements: 2.5_

---

## Phase 9: Cut Over to Event Sourcing

- [ ] 9. Remove direct PostgreSQL writes and make Kafka the source of truth

  - [ ] 9.1 Remove direct PostgreSQL writes from sync job
    - File: `apps/web/src/app/api/sync/route.ts`
    - Delete existing UPSERT statement (keep only `publishEvent` call)
    - Sync job now ONLY writes to Kafka
    - PostgreSQL updates handled exclusively by projection worker
    - Add logging: "Event published to Kafka, awaiting projection"
    - _Bug_Condition: Eliminates destructive UPSERT operations for C(X) inputs_
    - _Expected_Behavior: Event log becomes sole write path, audit history preserved_
    - _Preservation: Projection worker maintains same final state as direct writes_
    - _Requirements: 2.1, 2.5_

  - [ ] 9.2 Remove direct PostgreSQL writes from settlement hook
    - File: `apps/web/src/lib/db.ts` (function: `recordSettlement`)
    - Delete existing UPSERT/UPDATE statement (keep only `publishEvent` call)
    - Settlement hook now ONLY writes to Kafka
    - PostgreSQL updates handled exclusively by projection worker
    - Return success response immediately after Kafka publish
    - _Bug_Condition: Eliminates destructive attribution updates for C(X) inputs_
    - _Expected_Behavior: Settlement attribution preserved in event log_
    - _Preservation: Final attribution state matches direct write behavior_
    - _Requirements: 2.1, 2.5_

  - [ ] 9.3 Deploy cut-over changes to production
    - Deploy to Vercel production environment (atomic deploy)
    - Monitor sync job for 1 hour: Verify no errors, events publishing successfully
    - Monitor settlement hooks: Verify webhooks processing correctly
    - Monitor projection worker: Verify consuming events and updating PostgreSQL
    - Check `/api/payments` endpoint: Verify queries returning correct data
    - Rollback plan ready: Revert to Phase 5/6 code (re-enable direct PostgreSQL writes)
    - _Requirements: 2.1, 2.5, 2.6_

  - [ ] 9.4 Monitor for 24 hours post-deployment
    - Track Kafka publish latency (p99 should be <50ms)
    - Track projection worker lag (should be <100 messages)
    - Track sync job throughput (should be ≥95 ledgers/second)
    - Track `/api/payments` latency (should remain <100ms p99)
    - Check error logs: No Kafka publish failures
    - Check DLQ: No events in dead letter queue
    - If issues detected: Rollback to pre-cut-over state
    - If stable: Proceed to Phase 10
    - _Requirements: 2.1, 2.6_

---

## Phase 10: Projection Rebuild Validation

- [ ] 10. Rebuild payments table from Kafka events to validate event sourcing

  - [ ] 10.1 Create backup of payments table
    - Run SQL: `CREATE TABLE payments_backup AS SELECT * FROM payments;`
    - Verify backup row count matches production table
    - Record backup timestamp for audit trail
    - Purpose: Safety net for projection rebuild validation
    - _Preservation: Backup preserves current payment state for comparison_
    - _Requirements: 2.5_

  - [ ] 10.2 Reset projection worker to replay all events
    - Stop projection worker (Railway dashboard: pause service)
    - Reset consumer group offset to "earliest" (Upstash console or CLI)
    - Truncate `payments` table: `TRUNCATE TABLE payments;`
    - Truncate `event_offsets` table: `TRUNCATE TABLE event_offsets;`
    - Start projection worker to begin replay
    - Purpose: Validate that event log can rebuild complete state
    - _Bug_Condition: Tests that event log is sufficient source of truth for all C(X) and ¬C(X) states_
    - _Expected_Behavior: Payments table rebuilt to match pre-truncate state_
    - _Requirements: 2.5_

  - [ ] 10.3 Monitor projection replay progress
    - Track consumer lag in Upstash dashboard (should decrease monotonically)
    - Track `event_offsets` table growth (should match total events in Kafka)
    - Track `payments` table row count (should grow to match `payments_backup`)
    - Estimated time: ~5 minutes per 10,000 events at 50 events/second processing rate
    - Alert if replay stalls (lag not decreasing for 5 minutes)
    - _Requirements: 2.5, 2.6_

  - [ ] 10.4 Validate rebuilt payments table matches backup
    - After replay complete (lag = 0): Compare `payments` and `payments_backup`
    - Run SQL: `SELECT tx_hash FROM payments EXCEPT SELECT tx_hash FROM payments_backup;` (should return 0 rows)
    - Run SQL: `SELECT tx_hash FROM payments_backup EXCEPT SELECT tx_hash FROM payments;` (should return 0 rows)
    - For rows in both: Compare all fields (ledger, payer, amount, asset, ts, route, method, request_id, hook_reported_at)
    - Acceptable differences: Rows created during replay period (events after backup timestamp)
    - If mismatch detected: Investigate differences, fix bugs in projection worker, repeat from 10.2
    - If match: Mark projection rebuild successful
    - _Bug_Condition: Validates that event log contains complete audit trail for all C(X) operations_
    - _Expected_Behavior: Replayed projection matches original state, proving event sourcing correctness_
    - _Preservation: Final state matches pre-event-sourcing behavior exactly_
    - _Requirements: 2.5_

  - [ ] 10.5 Delete backup table after validation
    - If projection rebuild validated successfully: Drop `payments_backup` table
    - Document validation results in migration log
    - Mark migration complete in project documentation
    - _Requirements: 2.5_

---

## Phase 11: Implementation Validation

- [ ] 11. Verify bug condition exploration test now passes

  - **Property 1: Expected Behavior** - Audit History Preserved on Payment Updates
  - **IMPORTANT**: Re-run the SAME tests from Phase 1 - do NOT write new tests
  - The tests from Phase 1 encode the expected behavior
  - When these tests pass, it confirms the expected behavior is satisfied

  **Test 11.1: Indexer Double-Process Preserves History**
  - Re-run: Insert payment via sync job with `tx_hash="abc123"`, `amount="100"`
  - Then: Re-process same `tx_hash` with `amount="200"`
  - Assert: Query Kafka events for `tx_hash="abc123"`, retrieve both amount values (100 and 200)
  - Expected on FIXED code: PASSES - both states preserved in event log
  - Validates: Bug Condition fix - UPSERT no longer destroys audit history

  **Test 11.2: Webhook Retry Preserves Attribution History**
  - Re-run: Insert settlement attribution with `tx_hash="def456"`, `route="route-v1"`
  - Then: Receive duplicate webhook with `route="route-v2"`
  - Assert: Query Kafka events, retrieve both route values (route-v1 and route-v2)
  - Expected on FIXED code: PASSES - both attributions preserved in event log
  - Validates: Settlement hook no longer overwrites previous attribution

  **Test 11.3: Concurrent Update Preserves Both States**
  - Re-run: Simulate indexer and webhook updating same `tx_hash` simultaneously
  - Assert: Query Kafka events, verify both updates recorded with correct timestamps
  - Expected on FIXED code: PASSES - both updates preserved in event log
  - Validates: Event log captures all state changes regardless of timing

  **Test 11.4: Audit Timeline Query Succeeds**
  - Re-run: Query Kafka events for complete state history of `tx_hash="ghi789"`
  - Assert: Retrieve chronological list of all state changes
  - Expected on FIXED code: PASSES - complete audit trail available
  - Validates: Event log provides full historical audit capability

  - Run all tests on FIXED code (after event sourcing implementation)
  - **EXPECTED OUTCOME**: All tests PASS (confirms bug is fixed)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 12. Verify preservation tests still pass

  - **Property 2: Preservation** - Existing Read Operations and Query Behavior
  - **IMPORTANT**: Re-run the SAME tests from Phase 2 - do NOT write new tests
  - Run all preservation property tests from Phase 2

  **Test 12.1: API Query Response Format Unchanged**
  - Re-run: Query `/api/payments` with random parameters
  - Assert: Response format matches observed baseline from Phase 2
  - Expected on FIXED code: PASSES (no API breaking changes)

  **Test 12.2: Dashboard Display Behavior Unchanged**
  - Re-run: Render dashboard with random payment data
  - Assert: Display matches observed baseline from Phase 2
  - Expected on FIXED code: PASSES (no UI regressions)

  **Test 12.3: First-Time Insert Behavior Unchanged**
  - Re-run: Insert new payments (¬C(X) inputs)
  - Assert: Row creation matches observed baseline from Phase 2
  - Expected on FIXED code: PASSES (first inserts still work correctly)

  **Test 12.4: Sync State Cursor Behavior Unchanged**
  - Re-run: Run sync job, verify cursor advances correctly
  - Assert: Cursor behavior matches observed baseline from Phase 2
  - Expected on FIXED code: PASSES (sync cursor logic preserved)

  **Test 12.5: Analytics Query Compatibility Unchanged**
  - Re-run: Execute analytics queries against `payments` table
  - Assert: Results match observed baseline from Phase 2
  - Expected on FIXED code: PASSES (schema compatibility maintained)

  - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

---

## Phase 12: Monitoring and Observability

- [ ] 13. Set up monitoring, alerting, and operational runbooks

  - [ ] 13.1 Add Kafka metrics to observability dashboard
    - Track producer throughput (events/second published by sync job and settlement hook)
    - Track consumer lag (projection worker offset vs. latest Kafka offset)
    - Track publish latency (p50, p99, p999 for Kafka writes)
    - Track error rate (failed publishes, circuit breaker activations)
    - Track DLQ message count (events sent to dead letter queue)
    - Dashboard tools: Upstash console + custom Grafana/Datadog integration
    - _Requirements: 2.1, 2.6_

  - [ ] 13.2 Configure alerts for critical failures
    - Alert 1: Kafka unavailable for >5 minutes (circuit breaker open)
    - Alert 2: Projection worker lag >1000 messages for >10 minutes
    - Alert 3: DLQ receives any message (manual investigation required)
    - Alert 4: Sync job consecutive failures >3 (Kafka write errors)
    - Alert 5: Projection worker unhealthy (health check failing for >5 minutes)
    - Alert delivery: Slack webhook + PagerDuty for P0 incidents
    - _Requirements: 2.1, 2.6_

  - [ ] 13.3 Document operational runbooks
    - Runbook 1: "Kafka Down" - Steps to verify outage, rollback plan, escalation path
    - Runbook 2: "Projection Worker Crashed" - Steps to restart, verify offset, check DLQ
    - Runbook 3: "High Consumer Lag" - Steps to diagnose bottleneck, scale workers
    - Runbook 4: "DLQ Message Investigation" - Steps to replay failed event manually
    - Runbook 5: "Event Log Corruption" - Steps to validate event integrity, rebuild projection
    - Store in project wiki or Notion documentation
    - _Requirements: 2.5, 2.6_

  - [ ] 13.4 Train team on event sourcing concepts
    - Workshop: Event sourcing fundamentals (immutability, projections, replay)
    - Workshop: Kafka consumer group management (offsets, rebalancing, scaling)
    - Workshop: Debugging event-driven systems (tracing events, investigating lag)
    - Workshop: Idempotency and exactly-once semantics
    - Document common pitfalls and gotchas
    - _Requirements: 2.5, 2.6_

---

## Phase 13: Checkpoint

- [ ] 14. Final validation and success criteria verification
  - Ensure all tests pass (bug condition tests + preservation tests)
  - Verify audit history preserved for all payment updates (query Kafka for historical states)
  - Verify no data loss during Kafka outages (sync job and settlement hook fail safely)
  - Verify query performance unchanged (p99 latency <100ms for `/api/payments`)
  - Verify sync throughput acceptable (≥95 ledgers/second)
  - Verify projection rebuild works (replaying events rebuilds correct state within 1 hour)
  - Verify operational simplicity (projection worker runs 7+ days without manual intervention)
  - Ask user if any questions arise or additional validation needed

---

## Notes

**Critical Ordering**: This task list follows the bugfix workflow:

1. **Explore** (Phase 1): Write tests that FAIL on unfixed code to demonstrate the bug
2. **Preserve** (Phase 2): Write tests that PASS on unfixed code to capture existing behavior
3. **Implement** (Phases 3-10): Build event sourcing infrastructure and cut over
4. **Validate** (Phases 11-12): Re-run tests to verify fix works and no regressions introduced

**Property-Based Testing**: Phases 1 and 2 use property-based testing for stronger guarantees. Generate many test cases across input domains to catch edge cases.

**Idempotency**: Critical for both Kafka producers (duplicate publishes) and projection worker (duplicate event processing). Use UUID-based event IDs and PostgreSQL transaction atomicity.

**Rollback Safety**: Each phase has a rollback plan. If issues arise, revert to previous phase and investigate. Never proceed with known failures.

**Performance Targets**:

- Kafka publish latency: <50ms p99
- Sync throughput degradation: <5% (from 100 to ≥95 ledgers/second)
- API query latency: Unchanged (<100ms p99)
- Projection replay: <1 hour for full rebuild

**Compliance**: Event log retained for 7 days in Kafka. For longer retention, implement S3 archival (future enhancement).
