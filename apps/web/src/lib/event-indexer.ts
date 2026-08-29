/**
 * AnchorEvent and PruneEvent Indexing (#146).
 *
 * Stores Stellar contract events locally so the dashboard can serve batch
 * information without re-reading from RPC on every page view. Events are
 * indexed during sync and queried from the local database.
 *
 * Usage:
 *   import { indexContractEvents, getIndexedEvents } from '@/lib/event-indexer';
 *
 *   // During sync:
 *   await indexContractEvents(client, merchantId, events);
 *
 *   // When rendering dashboard:
 *   const events = await getIndexedEvents(client, merchantId, { type: 'AnchorEvent' });
 */

import type { PostgresClient } from './db';

export type EventType = 'AnchorEvent' | 'PruneEvent';

export interface IndexedEvent {
  id: number;
  merchantId: string;
  eventType: EventType;
  ledger: number;
  contractId: string;
  topic: string;
  data: unknown;
  indexedAt: string;
}

/**
 * Ensure the contract_events table exists.
 */
export async function ensureEventsSchema(client: PostgresClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS contract_events (
      id SERIAL PRIMARY KEY,
      merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      ledger INTEGER NOT NULL,
      contract_id VARCHAR(100) NOT NULL,
      topic TEXT NOT NULL,
      data JSONB,
      indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_contract_events_merchant_type
      ON contract_events(merchant_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_contract_events_merchant_ledger
      ON contract_events(merchant_id, ledger DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_events_contract
      ON contract_events(contract_id);
  `);
}

/**
 * Index a batch of contract events from the RPC response.
 * Deduplicates by (merchant_id, ledger, contract_id, topic).
 */
export async function indexContractEvents(
  client: PostgresClient,
  merchantId: string,
  events: Array<{
    eventType: EventType;
    ledger: number;
    contractId: string;
    topic: string;
    data?: unknown;
  }>,
): Promise<number> {
  if (events.length === 0) return 0;

  await ensureEventsSchema(client);

  let inserted = 0;
  for (const event of events) {
    const result = await client.query(
      `INSERT INTO contract_events (merchant_id, event_type, ledger, contract_id, topic, data)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM contract_events
         WHERE merchant_id = $1 AND ledger = $3 AND contract_id = $4 AND topic = $5
       )`,
      [
        merchantId,
        event.eventType,
        event.ledger,
        event.contractId,
        event.topic,
        event.data ? JSON.stringify(event.data) : null,
      ],
    );
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

/**
 * Get indexed events for a merchant, optionally filtered by type.
 */
export async function getIndexedEvents(
  client: PostgresClient,
  merchantId: string,
  opts: {
    type?: EventType;
    fromLedger?: number;
    toLedger?: number;
    limit?: number;
  } = {},
): Promise<IndexedEvent[]> {
  const limit = Math.min(opts.limit ?? 100, 500);

  let query = `
    SELECT id, merchant_id, event_type, ledger, contract_id, topic, data, indexed_at
    FROM contract_events
    WHERE merchant_id = $1
  `;
  const params: (string | number)[] = [merchantId];

  if (opts.type) {
    query += ` AND event_type = $${params.length + 1}`;
    params.push(opts.type);
  }
  if (opts.fromLedger !== undefined) {
    query += ` AND ledger >= $${params.length + 1}`;
    params.push(opts.fromLedger);
  }
  if (opts.toLedger !== undefined) {
    query += ` AND ledger <= $${params.length + 1}`;
    params.push(opts.toLedger);
  }

  query += ` ORDER BY ledger DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await client.query<{
    id: number;
    merchant_id: string;
    event_type: string;
    ledger: number;
    contract_id: string;
    topic: string;
    data: unknown;
    indexed_at: Date;
  }>(query, params);

  return result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    eventType: row.event_type as EventType,
    ledger: row.ledger,
    contractId: row.contract_id,
    topic: row.topic,
    data: row.data,
    indexedAt: row.indexed_at instanceof Date ? row.indexed_at.toISOString() : String(row.indexed_at),
  }));
}
