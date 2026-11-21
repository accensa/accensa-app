import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { withClient, ensureSchema, sweepExpiredNonces } from './db';

describe('challenge_nonces retention contract (#778)', () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL) {
      await withClient(ensureSchema);
    }
  });

  it('prunes consumed rows and unconsumed rows older than maxAgeMs, retaining fresh unconsumed rows', async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping integration test as DATABASE_URL is missing');
      return;
    }

    const testPrefix = `ret_${randomBytes(8).toString('hex')}`;
    const consumedNonce = `${testPrefix}_consumed`;
    const staleNonce = `${testPrefix}_stale`;
    const intermediateNonce = `${testPrefix}_intermediate`;
    const freshNonce = `${testPrefix}_fresh`;

    // 15-minute custom retention window exercised (900,000 ms)
    const customMaxAgeMs = 15 * 60 * 1000;

    await withClient(async (client) => {
      try {
        // 1. Fresh but consumed row (should be purged regardless of age)
        await client.query(
          `INSERT INTO challenge_nonces (nonce, issued_at, consumed)
           VALUES ($1, now(), true)`,
          [consumedNonce],
        );

        // 2. Unconsumed row older than 15 minutes (e.g. 25 minutes ago, should be purged)
        await client.query(
          `INSERT INTO challenge_nonces (nonce, issued_at, consumed)
           VALUES ($1, now() - interval '25 minutes', false)`,
          [staleNonce],
        );

        // 3. Unconsumed row older than default 10m but within custom 15m window (12 minutes ago, should survive)
        await client.query(
          `INSERT INTO challenge_nonces (nonce, issued_at, consumed)
           VALUES ($1, now() - interval '12 minutes', false)`,
          [intermediateNonce],
        );

        // 4. Fresh unconsumed row (issued 2 minutes ago, should survive)
        await client.query(
          `INSERT INTO challenge_nonces (nonce, issued_at, consumed)
           VALUES ($1, now() - interval '2 minutes', false)`,
          [freshNonce],
        );

        // Execute sweep with custom maxAgeMs
        await sweepExpiredNonces(client, customMaxAgeMs);

        // Query remaining nonces created by this test run
        const result = await client.query<{ nonce: string }>(
          `SELECT nonce FROM challenge_nonces
           WHERE nonce LIKE $1
           ORDER BY nonce ASC`,
          [`${testPrefix}%`],
        );

        const survivingNonces = result.rows.map((r) => r.nonce);

        // Assert exact surviving set, not merely a count
        expect(survivingNonces).toEqual([freshNonce, intermediateNonce]);
      } finally {
        // Clean up test nonces keyed by prefix
        await client.query(`DELETE FROM challenge_nonces WHERE nonce LIKE $1`, [`${testPrefix}%`]);
      }
    });
  });
});
