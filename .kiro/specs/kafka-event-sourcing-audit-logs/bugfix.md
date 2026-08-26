# Bugfix Requirements Document

## Introduction

The current payment indexer architecture uses PostgreSQL UPSERT operations that destroy historical state changes, violating audit trail requirements for compliance and deep analytics. When payment records are updated—either by the sync job indexing new transfer events or by settlement hooks attributing routes—the previous state is irrecoverably overwritten, making it impossible to reconstruct the timeline of changes or verify data integrity over time.

This bug affects two critical write paths:

1. **Indexer UPSERT** (`apps/web/src/app/api/sync/route.ts`): Overwrites payment rows when re-indexing or updating ledger data
2. **Settlement Hook UPSERT** (`recordSettlement` in `apps/web/src/lib/db.ts`): Overwrites attribution fields when webhooks fire multiple times

The lost audit history prevents compliance verification, makes debugging impossible when data discrepancies arise, and eliminates the ability to replay events to rebuild state after corruption or migration.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the sync job encounters a payment `tx_hash` that already exists in the `payments` table THEN the system overwrites the entire row with `ON CONFLICT (tx_hash) DO UPDATE`, destroying the previous values of `ledger`, `payer`, `amount`, `asset`, and `ts`

1.2 WHEN the settlement webhook receives attribution for a `tx_hash` that already has `hook_reported_at` data THEN the system overwrites the `route`, `method`, `request_id`, and `hook_reported_at` fields if the new timestamp is newer, destroying the previous attribution record

1.3 WHEN a payment row is updated multiple times (e.g., ledger reorg, webhook retry, data correction) THEN the system loses all intermediate states with no record of what changed, when it changed, or who triggered the change

1.4 WHEN attempting to audit historical payment state for compliance or debugging THEN the system cannot retrieve previous values because only the current state exists in the database

1.5 WHEN the database becomes corrupted or requires migration THEN the system cannot rebuild the correct state because the source-of-truth event log does not exist—only derived materialized views remain

### Expected Behavior (Correct)

2.1 WHEN the sync job or settlement hook needs to record a state change THEN the system SHALL append an immutable event to a Kafka topic (e.g., `stellar.transfer.observed`, `payment.attributed`) before updating any read model

2.2 WHEN a payment state change occurs THEN the system SHALL preserve the complete event in Kafka including: event type, timestamp, source (indexer or webhook), transaction hash, all field values, and causality metadata

2.3 WHEN multiple updates occur to the same payment THEN the system SHALL maintain the complete chronological sequence of events in Kafka, allowing reconstruction of the full state timeline

2.4 WHEN auditing historical payment state THEN the system SHALL support querying the event log to retrieve all state transitions for a given `tx_hash`, including who made the change and when

2.5 WHEN the read model (PostgreSQL `payments` table) requires rebuilding THEN the system SHALL replay all events from Kafka in order to reconstruct the current state, ensuring the materialized view matches the event log

2.6 WHEN projection workers consume events from Kafka THEN the system SHALL update the `payments` table to reflect the new state while maintaining idempotency (duplicate event processing produces the same result)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the existing `/api/payments` endpoint is queried THEN the system SHALL CONTINUE TO return payment records in the current format without breaking changes to the API contract

3.2 WHEN the dashboard displays payment history THEN the system SHALL CONTINUE TO show the latest state of each payment using the existing query patterns against the `payments` table

3.3 WHEN the sync job polls Stellar RPC for transfer events THEN the system SHALL CONTINUE TO use the same polling logic, filters, and pagination behavior

3.4 WHEN settlement webhooks arrive from x402 sellers THEN the system SHALL CONTINUE TO verify signatures, parse reports, and extract attribution metadata using the existing validation logic

3.5 WHEN a new payment is indexed for the first time (no prior event exists) THEN the system SHALL CONTINUE TO create a new row in the `payments` table with all fields populated from the Stellar event

3.6 WHEN the database schema is queried by existing analytics tools or admin queries THEN the system SHALL CONTINUE TO support the current `payments` table structure (adding event sourcing should not remove the materialized view)

3.7 WHEN the sync job completes a ledger range THEN the system SHALL CONTINUE TO update `sync_state` to record progress and enable resumption after interruption
