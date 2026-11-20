import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { withClient, ensureSchema, consumeSettlementNonce } from './db';
import { getMerchantByAddress } from './merchants';

const MERCHANT_ADDR = 'GNONCECONCURRENCYTEST000000000000000000000000000000';

describe('settlement nonce concurrency', () => {
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

  it('exactly one of 8 concurrent claims on the same nonce returns true', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping: DATABASE_URL not set');
      return;
    }

    const nonce = randomBytes(64).toString('hex');

    // Each call uses its own connection so they contend on the DB constraint
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withClient((client: Client) => consumeSettlementNonce(client, nonce, merchantId)),
      ),
    );

    const trueCount = results.filter(Boolean).length;
    expect(trueCount).toBe(1);
    expect(results.filter((r) => !r).length).toBe(7);
  });

  it('two concurrent claims on different nonces both succeed', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping: DATABASE_URL not set');
      return;
    }

    const nonceX = randomBytes(64).toString('hex');
    const nonceY = randomBytes(64).toString('hex');

    const [resultX, resultY] = await Promise.all([
      withClient((client: Client) => consumeSettlementNonce(client, nonceX, merchantId)),
      withClient((client: Client) => consumeSettlementNonce(client, nonceY, merchantId)),
    ]);

    expect(resultX).toBe(true);
    expect(resultY).toBe(true);
  });
});
