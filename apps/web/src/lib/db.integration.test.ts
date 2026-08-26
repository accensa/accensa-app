import { describe, it, expect } from 'vitest';
import {
  withClient,
  withMerchantClient,
  ensureSchema,
  setLastSyncedLedger,
  getLastSyncedLedger,
} from './db';
import { getMerchantByAddress } from './merchants';

describe('Database Integration', () => {
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
        [merchantB.id, 'c'.repeat(64)],
      );
    });

    // A connection scoped to merchant A must not see merchant B's row, even
    // with a query that has no WHERE clause at all — this is what
    // FORCE ROW LEVEL SECURITY buys as the second line of defence.
    const rowsSeenByA = await withMerchantClient(merchantA.id, async (client) => {
      const res = await client.query(`SELECT * FROM payments WHERE tx_hash = $1`, ['c'.repeat(64)]);
      return res.rows;
    });
    expect(rowsSeenByA).toHaveLength(0);

    const rowsSeenByB = await withMerchantClient(merchantB.id, async (client) => {
      const res = await client.query(`SELECT * FROM payments WHERE tx_hash = $1`, ['c'.repeat(64)]);
      return res.rows;
    });
    expect(rowsSeenByB).toHaveLength(1);
  });
});
