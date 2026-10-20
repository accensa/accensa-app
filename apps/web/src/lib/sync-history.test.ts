import { describe, expect, it, vi } from 'vitest';
import type { PostgresClient } from './db';
import { getSyncHistory } from './sync-history';

type SyncEventRow = {
  ledger: number;
  synced_at: Date;
  payments_inserted: number;
  duration_ms: number;
};

function createClient(rows: SyncEventRow[] = []) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total: '42' }] })
    .mockResolvedValueOnce({ rows });

  return { client: { query } as unknown as PostgresClient, query };
}

function event(ledger: number): SyncEventRow {
  return {
    ledger,
    synced_at: new Date('2026-01-01T00:00:00.000Z'),
    payments_inserted: 2,
    duration_ms: 15,
  };
}

function pageQuery(query: ReturnType<typeof vi.fn>) {
  return query.mock.calls[2] as [string, unknown[]];
}

describe('getSyncHistory', () => {
  it('forwards a parsed ledger cursor to the keyset query', async () => {
    const { client, query } = createClient();

    await getSyncHistory(client, 'merchant-1', { cursor: 'ledger:123' });

    const [sql, params] = pageQuery(query);
    expect(sql).toContain('AND ledger < $2');
    expect(params).toEqual(['merchant-1', 123, 21]);
  });

  it.each(['ledger:abc', '123', null])(
    'ignores malformed or absent cursor %s without throwing',
    async (cursor) => {
      const { client, query } = createClient();
      const options = cursor === null ? {} : { cursor };

      await expect(getSyncHistory(client, 'merchant-1', options)).resolves.toMatchObject({
        nextCursor: null,
      });

      const [sql, params] = pageQuery(query);
      expect(sql).not.toContain('AND ledger <');
      expect(params).toEqual(['merchant-1', 21]);
    },
  );

  it.each([
    { options: {}, expectedLimit: 20 },
    { options: { limit: 150 }, expectedLimit: 100 },
  ])('uses the default or clamped page limit', async ({ options, expectedLimit }) => {
    const { client, query } = createClient();

    await getSyncHistory(client, 'merchant-1', options);

    const [, params] = pageQuery(query);
    expect(params[params.length - 1]).toBe(expectedLimit + 1);
  });

  it('trims an extra row and advances the cursor from the last returned entry', async () => {
    const { client } = createClient(Array.from({ length: 21 }, (_, index) => event(200 - index)));

    const page = await getSyncHistory(client, 'merchant-1');

    expect(page.entries).toHaveLength(20);
    expect(page.entries[page.entries.length - 1]?.ledger).toBe(181);
    expect(page.nextCursor).toBe('ledger:181');
  });

  it('does not return a next cursor when the page is short', async () => {
    const { client } = createClient([event(3), event(2), event(1)]);

    const page = await getSyncHistory(client, 'merchant-1');

    expect(page.entries.map(({ ledger }) => ledger)).toEqual([3, 2, 1]);
    expect(page.nextCursor).toBeNull();
  });
});
