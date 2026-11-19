import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import {
  recordMerchantConfigChange,
  listMerchantConfigHistory,
  type MerchantConfigChange,
} from './merchant-config';

/** A fake pg client that records every query and returns canned rows. */
function fakeClient(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { client: { query } as unknown as Client, query };
}

describe('recordMerchantConfigChange', () => {
  it('creates the audit table idempotently before writing', async () => {
    const { client, query } = fakeClient();

    await recordMerchantConfigChange(client, {
      merchantId: 7,
      field: 'webhook_url',
      before: null,
      after: 'https://new.example.com/hook',
      source: 'profile_patch',
    });

    const ddl = String(query.mock.calls[0][0]);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS merchant_config_events');
    expect(ddl).toContain('CREATE INDEX IF NOT EXISTS merchant_config_events_merchant_idx');
  });

  it('inserts the change with every field bound as a parameter', async () => {
    const { client, query } = fakeClient();

    await recordMerchantConfigChange(client, {
      merchantId: 7,
      field: 'status',
      before: 'active',
      after: 'paused',
      source: 'indexer_event',
    });

    const [sql, params] = query.mock.calls[1];
    expect(String(sql)).toContain('INSERT INTO merchant_config_events');
    expect(params?.slice(0, 5)).toEqual([7, 'status', 'active', 'paused', 'indexer_event']);
  });

  it('defaults occurred_at to now when omitted', async () => {
    const { client, query } = fakeClient();
    const before = Date.now();

    await recordMerchantConfigChange(client, {
      merchantId: 1,
      field: 'fee_bps',
      before: '100',
      after: '150',
      source: 'profile_patch',
    });

    const occurredAt = query.mock.calls[1][1]?.[5] as Date;
    expect(occurredAt).toBeInstanceOf(Date);
    expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('uses the supplied occurredAt when provided', async () => {
    const { client, query } = fakeClient();
    const occurredAt = new Date('2026-08-20T07:22:16Z');

    await recordMerchantConfigChange(client, {
      merchantId: 1,
      field: 'fee_bps',
      before: '100',
      after: '150',
      source: 'profile_patch',
      occurredAt,
    });

    expect(query.mock.calls[1][1]?.[5]).toBe(occurredAt);
  });

  it('persists null before/after values for a cleared field', async () => {
    const { client, query } = fakeClient();

    await recordMerchantConfigChange(client, {
      merchantId: 3,
      field: 'webhook_url',
      before: 'https://old.example.com/hook',
      after: null,
      source: 'profile_patch',
    });

    const params = query.mock.calls[1][1] as unknown[];
    expect(params[2]).toBe('https://old.example.com/hook');
    expect(params[3]).toBeNull();
  });
});

describe('listMerchantConfigHistory', () => {
  it('queries newest-first, scoped to one merchant', async () => {
    const { client, query } = fakeClient();

    await listMerchantConfigHistory(client, 7);

    const [sql, params] = query.mock.calls[1];
    expect(String(sql)).toContain('WHERE merchant_id = $1');
    expect(String(sql)).toContain('ORDER BY occurred_at DESC');
    expect(params).toEqual([7, 50]);
  });

  it('clamps the limit between 1 and 200', async () => {
    const cases: [number | undefined, number][] = [
      [undefined, 50],
      [0, 1],
      [-25, 1],
      [1, 1],
      [200, 200],
      [201, 200],
      [10_000, 200],
    ];

    for (const [limit, expected] of cases) {
      const { client, query } = fakeClient();
      await listMerchantConfigHistory(client, 7, limit === undefined ? {} : { limit });
      expect(query.mock.calls[1][1]).toEqual([7, expected]);
    }
  });

  it('maps rows into MerchantConfigChange objects', async () => {
    const occurredAt = new Date('2026-08-20T07:22:16Z');
    const { client } = fakeClient([
      {
        id: 1,
        merchant_id: 7,
        field: 'webhook_url',
        before: null,
        after: 'https://new.example.com/hook',
        source: 'profile_patch',
        occurred_at: occurredAt,
      },
    ]);

    const history: MerchantConfigChange[] = await listMerchantConfigHistory(client, 7);

    expect(history).toEqual([
      {
        merchantId: 7,
        field: 'webhook_url',
        before: null,
        after: 'https://new.example.com/hook',
        source: 'profile_patch',
        occurredAt,
      },
    ]);
    expect(history[0]).not.toHaveProperty('id');
  });

  it('returns an empty history when there are no events', async () => {
    const { client } = fakeClient();
    await expect(listMerchantConfigHistory(client, 99)).resolves.toEqual([]);
  });
});
