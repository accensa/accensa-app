# Database Migrations

This directory contains versioned SQL migrations applied sequentially to maintain PostgreSQL schema integrity across environments.

## Prefix Renumbering

Historically, several migrations shared colliding numerical prefixes: two files were named `002_` and four files were named `003_`. When running a glob like `psql -f migrations/*.sql`, execution order was determined by characters after the underscore rather than deliberate sequence numbering.

To make migration order unambiguous, deterministic, and self-documenting, the files have been renumbered to unique, contiguous three-digit prefixes (`001` through `014`). The new numbering preserves the exact historical lexicographical execution sequence byte-for-byte.

## Old-to-New Filename Map

| Old Filename                              | New Filename                              | Purpose / Schema Impact                                                            |
| ----------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `001_unify_payments.sql`                  | `001_unify_payments.sql`                  | Canonical unified `payments` table schema.                                         |
| `002_settlement_attribution.sql`          | `002_settlement_attribution.sql`          | Adds `hook_reported_at` for merchant x402 settlement attribution.                  |
| `002_sync_state_and_challenge_nonces.sql` | `003_sync_state_and_challenge_nonces.sql` | Creates `sync_state` and `challenge_nonces` tables prior to multi-merchant ALTERs. |
| `003_multi_merchant.sql`                  | `004_multi_merchant.sql`                  | Introduces `merchants` table and row-level security policies across tables.        |
| `003_receipt_batches.sql`                 | `005_receipt_batches.sql`                 | Creates `receipt_batches` table for on-chain Merkle root anchor tracking.          |
| `003_tenant_shard_columns.sql`            | `006_tenant_shard_columns.sql`            | Adds `workspace_id` tenant sharding columns to multi-tenant tables.                |
| `003_webhook_deliveries.sql`              | `007_webhook_deliveries.sql`              | Creates `webhook_deliveries` and `webhook_attempts` tables.                        |
| `004_schema_parity_and_keyset_index.sql`  | `008_schema_parity_and_keyset_index.sql`  | Adds keyset pagination index `idx_payments_merchant_ts_txhash`.                    |
| `005_zk_commitments.sql`                  | `009_zk_commitments.sql`                  | Creates `zk_commitments` table for zero-knowledge transaction proofs.              |
| `006_payments_filter_indexes.sql`         | `010_payments_filter_indexes.sql`         | Partial indexes on `payments` for filtered route/payer queries.                    |
| `007_role_tuples.sql`                     | `011_role_tuples.sql`                     | Creates `role_tuples` table for Zanzibar-style relationship permissions.           |
| `008_inventory_reservations.sql`          | `012_inventory_reservations.sql`          | Creates `inventory_items`, `inventory_reservations`, and line-item tables.         |
| `009_multi_store_organizations.sql`       | `013_multi_store_organizations.sql`       | Creates `merchant_stores`, `merchant_api_keys`, and `merchant_catalog_items`.      |
| —                                         | `014_payment_fee_stroops.sql`             | Adds nullable `fee_stroops` to `payments` for observed network fees.               |

## Invariant Enforcement

The prefix order and map consistency are verified in automated test suites:

- Every prefix must be a 3-digit number starting at `001`.
- Prefixes must be strictly contiguous with zero gaps and zero duplicates.
- Every migration file in this directory must have a corresponding entry in this map.
