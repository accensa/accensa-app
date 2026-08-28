import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from 'pg';
import {
  withClient,
  ensureSchema,
  setLastSyncedLedger,
  getLastSyncedLedger,
  rollbackSyncToLedger,
} from './db';
import { insertPaymentsInTransaction } from './insert-payments';
import { getMerchantByAddress } from './merchants';

/**
 * Brings the schema up and grants the non-superuser test role everything it
 * needs to drive RLS as the app would.
 *
 * Run once up front (not per connection) so `withMerchantClient` can be called
 * concurrently without racing on catalog rows. On PostgreSQL 15 the `public`
 * schema is no longer world-writable, so the role must be granted CREATE on it
 * and be made the owner of the tables it re-runs DDL against via `ensureSchema`.
 */
async function setupTestDatabase(): Promise<void> {
  await withClient(async (client) => {
    await ensureSchema(client);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'test_app_user') THEN
          CREATE ROLE test_app_user;
        END IF;
      END $$;
    `);
    await client.query('GRANT USAGE, CREATE ON SCHEMA public TO test_app_user');
    for (const table of ['payments', 'sync_state', 'challenge_nonces', 'merchants']) {
      await client.query(`ALTER TABLE IF EXISTS ${table} OWNER TO test_app_user`).catch(() => {});
    }
    await client.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO test_app_user');
    await client.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO test_app_user');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO test_app_user');
  });
}

async function withMerchantClient<T>(
  merchantId: number,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    // Switch to non-superuser so RLS policies are enforced
    await client.query('SET SESSION AUTHORIZATION test_app_user');

    await client.query('SELECT set_config($1, $2, false)', [
      'accensa.merchant_id',
      String(merchantId),
    ]);
    return fn(client);
  });
}

describe('Database Integration', () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL) {
      await setupTestDatabase();
    }
  });

  it('should ensure schema and perform basic operations', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        ['GTESTMERCHANTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
      );
    });

    const merchant = await withClient(async (client) => {
      await ensureSchema(client);
      return getMerchantByAddress(
        client,
        'GTESTMERCHANTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
    });
    expect(merchant).not.toBeNull();

    await withMerchantClient(merchant!.id, async (client) => {
      await ensureSchema(client);
      await setLastSyncedLedger(client, merchant!.id, 42);
      const ledger = await getLastSyncedLedger(client, merchant!.id);
      expect(ledger).toBe(42);
    });
  });

  it('advances each merchant’s cursor independently, including a quiet merchant with no activity', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const [merchantA, merchantB] = await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1), ($2) ON CONFLICT (address) DO NOTHING`,
        [
          'GACTIVEMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GQUIETMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        ],
      );
      const a = await getMerchantByAddress(
        client,
        'GACTIVEMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      const b = await getMerchantByAddress(
        client,
        'GQUIETMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      return [a!, b!];
    });

    // Merchant A processes ledgers; merchant B sees no activity at all this
    // run. Its cursor must still advance — this is exactly the bug that let
    // 207 ledgers fall outside RPC retention in the original outage.
    await withMerchantClient(merchantA.id, async (client) => {
      await setLastSyncedLedger(client, merchantA.id, 1000);
    });
    await withMerchantClient(merchantB.id, async (client) => {
      await setLastSyncedLedger(client, merchantB.id, 1000);
    });

    const [ledgerA, ledgerB] = await Promise.all([
      withMerchantClient(merchantA.id, (client) => getLastSyncedLedger(client, merchantA.id)),
      withMerchantClient(merchantB.id, (client) => getLastSyncedLedger(client, merchantB.id)),
    ]);
    expect(ledgerA).toBe(1000);
    expect(ledgerB).toBe(1000);

    // Advancing one merchant's cursor must never move the other's.
    await withMerchantClient(merchantA.id, async (client) => {
      await setLastSyncedLedger(client, merchantA.id, 2000);
    });
    const ledgerBAfter = await withMerchantClient(merchantB.id, (client) =>
      getLastSyncedLedger(client, merchantB.id),
    );
    expect(ledgerBAfter).toBe(1000);
  });

  it('row-level security prevents a merchant-scoped connection from reading another merchant’s payments', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const [merchantA, merchantB] = await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1), ($2) ON CONFLICT (address) DO NOTHING`,
        [
          'GRLSMERCHANTAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GRLSMERCHANTBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        ],
      );
      const a = await getMerchantByAddress(
        client,
        'GRLSMERCHANTAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      const b = await getMerchantByAddress(
        client,
        'GRLSMERCHANTBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      );
      return [a!, b!];
    });

    await withMerchantClient(merchantB.id, async (client) => {
      await client.query(
        `INSERT INTO payments (merchant_id, tx_hash) VALUES ($1, $2)
         ON CONFLICT (merchant_id, tx_hash) DO NOTHING`,
        [merchantB.id, 'c'.repeat(63)],
      );
    });

    // A connection scoped to merchant A must not see merchant B's row, even
    // with a query that has no WHERE clause at all — this is what
    // FORCE ROW LEVEL SECURITY buys as the second line of defence.
    const rowsSeenByA = await withMerchantClient(merchantA.id, async (client) => {
      const res = await client.query(`SELECT * FROM payments WHERE tx_hash = $1`, ['c'.repeat(63)]);
      return res.rows;
    });
    expect(rowsSeenByA).toHaveLength(0);

    const rowsSeenByB = await withMerchantClient(merchantB.id, async (client) => {
      const res = await client.query(`SELECT * FROM payments WHERE tx_hash = $1`, ['c'.repeat(63)]);
      return res.rows;
    });
    expect(rowsSeenByB).toHaveLength(1);
  });

  it('batched inserts write many rows in one statement and commit the cursor atomically', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const merchant = await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        ['GBATCHMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
      );
      return getMerchantByAddress(client, 'GBATCHMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });
    expect(merchant).not.toBeNull();

    const rows = Array.from({ length: 3 }, (_, i) => ({
      merchantId: merchant!.id,
      txHash: 'b'.repeat(63) + i,
      ledger: 100 + i,
      payer: 'G' + 'B'.repeat(55),
      amount: String(1000 * (i + 1)),
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ts: new Date(Date.UTC(2026, 7, 1, 0, 0, i)).toISOString(),
    }));

    const result = await withMerchantClient(merchant!.id, async (client) => {
      await ensureSchema(client);
      return insertPaymentsInTransaction(client, merchant!.id, rows, 500);
    });

    expect(result.inserted).toBe(3);
    expect(result.payments).toHaveLength(3);

    // All three rows committed, and the cursor advanced to 500 in the same
    // transaction.
    await withMerchantClient(merchant!.id, async (client) => {
      const res = await client.query(
        `SELECT ledger, payer, amount, asset, ts FROM payments WHERE merchant_id = $1 ORDER BY ledger`,
        [merchant!.id],
      );
      expect(res.rows).toHaveLength(3);
      // ledger is BIGINT and comes back as a string from pg's default parser.
      expect(res.rows.map((r) => Number(r.ledger))).toEqual([100, 101, 102]);
      const cursor = await getLastSyncedLedger(client, merchant!.id);
      expect(cursor).toBe(500);
    });
  });

  it('purges rolled-back ledgers and rewinds the cursor, keeping staged rows', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const merchant = await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        ['GROLLBACKMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
      );
      return getMerchantByAddress(client, 'GROLLBACKMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });
    expect(merchant).not.toBeNull();

    // Three indexed payments at ledgers 100-102, plus one staged,
    // merchant-reported row whose ledger the chain has not filled in yet.
    await withMerchantClient(merchant!.id, async (client) => {
      await client.query(
        `INSERT INTO payments (merchant_id, tx_hash, ledger) VALUES
         ($1, $2, 100), ($1, $3, 101), ($1, $4, 102)`,
        [merchant!.id, 'd'.repeat(63) + '0', 'd'.repeat(63) + '1', 'd'.repeat(63) + '2'],
      );
      await client.query(
        `INSERT INTO payments (merchant_id, tx_hash, ledger, route) VALUES ($1, $2, NULL, '/api/x')`,
        [merchant!.id, 'd'.repeat(63) + '3'],
      );
      await setLastSyncedLedger(client, merchant!.id, 102);
    });

    // The node rolled back to head 100: everything indexed past it is gone.
    const { purged } = await withMerchantClient(merchant!.id, async (client) => {
      await ensureSchema(client);
      return rollbackSyncToLedger(client, merchant!.id, 100);
    });
    expect(purged).toBe(2);

    await withMerchantClient(merchant!.id, async (client) => {
      const res = await client.query(
        `SELECT tx_hash, ledger FROM payments WHERE merchant_id = $1 ORDER BY ledger NULLS LAST`,
        [merchant!.id],
      );
      // Ledger 100 survived; 101 and 102 were purged; the staged NULL-ledger
      // row (attribution awaiting the chain) was left alone.
      expect(res.rows.map((r) => (r.ledger === null ? null : Number(r.ledger)))).toEqual([
        100,
        null,
      ]);
      // The cursor rewound with the purge, so the next run resumes from 101.
      expect(await getLastSyncedLedger(client, merchant!.id)).toBe(100);
    });
  });

  it('batched inserts preserve ON CONFLICT semantics and the ledger-NULL guard', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const merchant = await withClient(async (client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        ['GBCONFLICTMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
      );
      return getMerchantByAddress(client, 'GBCONFLICTMERCHANTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    });
    expect(merchant).not.toBeNull();

    const txHash = 'c'.repeat(63) + '1';

    // A merchant-reported row exists first — route attribution arrived before
    // the indexer saw the transfer, which is the normal ordering. It has a
    // NULL ledger.
    await withMerchantClient(merchant!.id, async (client) => {
      await client.query(
        `INSERT INTO payments (merchant_id, tx_hash, route, method)
         VALUES ($1, $2, '/api/hello', 'GET')`,
        [merchant!.id, txHash],
      );
    });

    const row = {
      merchantId: merchant!.id,
      txHash,
      ledger: 300,
      payer: 'G' + 'C'.repeat(55),
      amount: '5000',
      asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      ts: '2026-08-01T00:00:00.000Z',
    };

    const result = await withMerchantClient(merchant!.id, async (client) => {
      await ensureSchema(client);
      return insertPaymentsInTransaction(client, merchant!.id, [row], 600);
    });

    // The conflicting row was updated (ledger-NULL guard passed) and returned.
    expect(result.inserted).toBe(1);

    await withMerchantClient(merchant!.id, async (client) => {
      const res = await client.query(
        `SELECT ledger, payer, amount, asset, ts, route, method FROM payments WHERE merchant_id = $1 AND tx_hash = $2`,
        [merchant!.id, txHash],
      );
      const payment = res.rows[0];
      // Ledger-owned columns were written by the indexer...
      expect(Number(payment.ledger)).toBe(300);
      expect(payment.payer).toBe('G' + 'C'.repeat(55));
      expect(payment.amount).toBe('5000');
      expect(payment.ts).toBeInstanceOf(Date);
      // ...and merchant-reported columns were left alone.
      expect(payment.route).toBe('/api/hello');
      expect(payment.method).toBe('GET');
    });

    // Re-indexing the same transfer is a no-op: the row now has a ledger, so
    // the DO UPDATE guard fails and nothing is written or returned.
    const second = await withMerchantClient(merchant!.id, async (client) => {
      return insertPaymentsInTransaction(client, merchant!.id, [{ ...row, ledger: 301 }], 601);
    });
    expect(second.inserted).toBe(0);
  });
});
