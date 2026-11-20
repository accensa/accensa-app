import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { withClient, ensureSchema, consumeSettlementNonce, SETTLE_NONCE_RETENTION_MS } from './db';
import { getMerchantByAddress } from './merchants';

const MERCHANT_ADDR = 'GNONCESWEEPTEST0000000000000000000000000000000000000';

describe('settlement nonce retention sweep', () => {
  let merchantId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const merchant = await withClient(async (client: Client) => {
      await ensureSchema(client);
      await client.query(
        `INSERT INTO merchants (address) VALUES ($1) ON CONFLICT (address) DO NOTHING`,
        [MERCHANT_ADDR],
      );
      return getMerchantByAddress(client, MERCHANT_ADDR);
    });
    if (!merchant) throw new Error('failed to create test merchant');
    merchantId = merchant.id;
  });

  it('deletes rows at and beyond the retention boundary, keeps newer rows', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping: DATABASE_URL not set');
      return;
    }

    // Row A: 1 minute newer than the boundary → should survive the sweep
    const nonceA = randomBytes(64).toString('hex');
    // Row B: exactly at the boundary → deleted (time elapses between insert and delete)
    const nonceB = randomBytes(64).toString('hex');
    // Row C: 1 minute older than the boundary → deleted
    const nonceC = randomBytes(64).toString('hex');
    // The nonce we claim — triggers the sweep
    const nonceCall = randomBytes(64).toString('hex');

    await withClient(async (client: Client) => {
      await client.query(
        `INSERT INTO settle_nonces (nonce, merchant_id, first_seen)
         VALUES ($1, $2, now() - interval '1 millisecond' * $3)`,
        [nonceA, merchantId, SETTLE_NONCE_RETENTION_MS - 60_000],
      );
      await client.query(
        `INSERT INTO settle_nonces (nonce, merchant_id, first_seen)
         VALUES ($1, $2, now() - interval '1 millisecond' * $3)`,
        [nonceB, merchantId, SETTLE_NONCE_RETENTION_MS],
      );
      await client.query(
        `INSERT INTO settle_nonces (nonce, merchant_id, first_seen)
         VALUES ($1, $2, now() - interval '1 millisecond' * $3)`,
        [nonceC, merchantId, SETTLE_NONCE_RETENTION_MS + 60_000],
      );
    });

    // Trigger the sweep by consuming a fresh nonce
    const claimed = await withClient((client: Client) =>
      consumeSettlementNonce(client, nonceCall, merchantId),
    );
    expect(claimed).toBe(true);

    // Second call with the same nonce must return false (already consumed)
    const second = await withClient((client: Client) =>
      consumeSettlementNonce(client, nonceCall, merchantId),
    );
    expect(second).toBe(false);

    // Verify which of our seed rows survived
    await withClient(async (client: Client) => {
      const { rows } = await client.query<{ nonce: string }>(
        `SELECT nonce FROM settle_nonces WHERE nonce IN ($1, $2, $3)`,
        [nonceA, nonceB, nonceC],
      );
      const remaining = rows.map((r) => r.nonce);
      expect(remaining).toContain(nonceA);
      expect(remaining).not.toContain(nonceB);
      expect(remaining).not.toContain(nonceC);
    });
  });
});
