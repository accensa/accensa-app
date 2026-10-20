# Local Database Setup

The indexer and dashboard require a running PostgreSQL instance. This guide walks
through provisioning one locally with Docker, connecting the app, and verifying
that everything works.

## Prerequisites

- Docker
- Node 22+
- pnpm 9

## 1. Start a PostgreSQL container

```bash
docker run --name pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres
```

This starts the latest `postgres` image in the background, mapping port 5432 on
your machine to the container. The data lives in a Docker volume named
`pg` — it survives container restarts.

To stop it later: `docker stop pg`. To remove it and its data:
`docker rm -v pg`.

### Connecting with psql (optional)

```bash
docker exec -it pg psql -U postgres
```

You can use this to inspect the schema after the app has run its first request.

## 2. Configure `apps/web/.env.local`

Create `apps/web/.env.local` with the following contents:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
MERCHANT_ADDRESS=GCALKSGAZRJLSUEJT3M5W6LN4R7XQOLIRCOS6ZA6EDZVTZDBIIPPFKJ6
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
ACCENSA_PRIVATE_KEY_HEX=replace-with-32-byte-ed25519-private-key-hex
```

`DATABASE_URL` is a standard `libpq` connection string. The format is:

```
postgres://<user>:<password>@<host>:<port>/<database>
```

All four values in the example above match the `docker run` command from step 1.
If you change the port or password, update the URL accordingly.

> **Note:** `DATABASE_URL` is not committed to the repo — `.env.local` is
> gitignored. Every developer sets their own.

## 3. Schema initialization

**No manual migration step is required.** The schema is created automatically on
the first API request.

Every API route in `apps/web/src/lib/db.ts` calls `ensureSchema(client)` before
running its query. This function runs idempotent DDL — `CREATE TABLE IF NOT
EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — so a fresh
database gets its tables on the very first request, and existing databases are
quietly brought up to date if the schema has changed.

The fourteen tables created are grouped by purpose below:

| Purpose / Domain         | Table Names                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Core Indexer & Auth**  | `payments`, `sync_state`, `challenge_nonces`, `merchants`                                            |
| **Tenancy & Roles**      | `role_tuples`, `merchant_stores`, `merchant_api_keys`                                                |
| **Inventory Management** | `merchant_catalog_items`, `inventory_items`, `inventory_reservations`, `inventory_reservation_items` |
| **Webhooks & Batches**   | `receipt_batches`, `webhook_deliveries`, `webhook_attempts`                                          |

### How to verify

Start the dashboard:

```bash
cd apps/web
pnpm install
pnpm dev
```

Then trigger an index run:

```bash
curl localhost:3000/api/sync
```

This hits the `/api/sync` endpoint, which calls `ensureSchema()` and creates
the tables. You can now inspect them:

```bash
docker exec -it pg psql -U postgres -c "\dt"

              List of relations
 Schema |             Name             | Type  |  Owner
--------+------------------------------+-------+----------
 public | challenge_nonces             | table | postgres
 public | inventory_items              | table | postgres
 public | inventory_reservation_items  | table | postgres
 public | inventory_reservations       | table | postgres
 public | merchant_api_keys            | table | postgres
 public | merchant_catalog_items       | table | postgres
 public | merchant_stores              | table | postgres
 public | merchants                    | table | postgres
 public | payments                     | table | postgres
 public | receipt_batches              | table | postgres
 public | role_tuples                  | table | postgres
 public | sync_state                   | table | postgres
 public | webhook_attempts             | table | postgres
 public | webhook_deliveries           | table | postgres
```

### Reference migrations

The `migrations/` directory contains SQL files that document the schema's
evolution:

- `migrations/001_unify_payments.sql` — unifies historical payments table variants into the current canonical shape
- `migrations/002_settlement_attribution.sql` — adds `hook_reported_at` and drops NOT NULL on `amount`/`payer` for merchant-reported settlements
- `migrations/003_multi_merchant.sql` — introduces multi-merchant support and row-level security policies
- `migrations/004_receipt_batches.sql` — adds receipt batching and Merkle root anchoring tables
- `migrations/005_zk_commitments.sql` — adds zero-knowledge commitment ledger tables
- `migrations/006_merchant_profiles.sql` — adds merchant profile settings and overrides
- `migrations/007_role_tuples.sql` — creates `role_tuples` for Zanzibar-style permissions
- `migrations/008_inventory_reservations.sql` — creates inventory catalog, items, and reservation tables
- `migrations/009_multi_store_organizations.sql` — adds multi-store organization and store tables
- `migrations/010_notifications.sql` — adds merchant notification center tables
- `migrations/011_chat_notifiers.sql` — adds chat notifier integrations for Telegram and Discord
- `migrations/012_disputes.sql` — sets up dispute chat and tracking evidence tables

These files are **not executed by any tool**. They exist as documentation of what
`ensureSchema()` does in code. If you need to understand why a column exists or
what changed, read the corresponding migration file for the full rationale.

## 4. Environment variables reference

| Variable                  | Required | Description                                                                     |
| ------------------------- | -------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | PostgreSQL connection string (see format above)                                 |
| `MERCHANT_ADDRESS`        | Yes      | Stellar public key of the merchant to index payments for                        |
| `STELLAR_RPC_URL`         | Yes      | Soroban RPC endpoint (testnet: `https://soroban-testnet.stellar.org`)           |
| `ACCENSA_PRIVATE_KEY_HEX` | No*      | Shared secret for `POST /api/hook/settle`. Required for route-level attribution |
| `CRON_SECRET`             | No       | Bearer token protecting the cron-triggered `GET /api/sync` endpoint             |

All variables go in `apps/web/.env.local`.

## Troubleshooting

### "relation "sync_state" does not exist"

This means `ensureSchema()` has not run yet. Hit any API endpoint —
`curl localhost:3000/api/sync` is the simplest — and the tables will be created.

### "DATABASE_URL is not configured"

`apps/web/.env.local` either does not exist or is missing the `DATABASE_URL`
line. See step 2.

### Connection refused

- Confirm the Docker container is running: `docker ps`
- Confirm port 5432 is not already in use on the host: `lsof -i :5432`
- If you changed the port in `docker run`, update the port in `DATABASE_URL`
  accordingly.

### Container name already exists

Remove the old container first:

```bash
docker rm -f pg
```

Then re-run the `docker run` command.
