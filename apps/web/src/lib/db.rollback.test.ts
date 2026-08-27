import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import { rollbackSyncToLedger } from './db';

/** Records every query; DELETE FROM payments returns a configurable rowCount. */
function fakeClient(opts: { failDelete?: boolean; deleted?: number } = {}) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (/^SELECT pg_advisory_xact_lock/m.test(sql)) return { rows: [] };
      if (/^DELETE FROM payments/m.test(sql)) {
        if (opts.failDelete) throw new Error('connection reset mid-delete');
        return { rows: [], rowCount: opts.deleted ?? 3 };
      }
      if (/^INSERT INTO sync_state/m.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
  return { client: client as unknown as Client, queries };
}

describe('rollbackSyncToLedger', () => {
  it('purges payments past the corrected head and rewinds the cursor atomically', async () => {
    const { client, queries } = fakeClient();

    const result = await rollbackSyncToLedger(client, 7, 5_000);

    expect(result).toEqual({ purged: 3 });
    expect(queries[0]).toBe('BEGIN');

    // Same advisory lock setLastSyncedLedger takes, so a concurrent forward
    // run cannot interleave with the rewind.
    expect(queries).toContain('SELECT pg_advisory_xact_lock($1)');

    // Only this merchant's rows past the head are removed — staged rows with
    // a NULL ledger (ledger > $2 cannot match) survive the purge.
    const del = queries.find((q) => /^DELETE FROM payments/m.test(q))!;
    expect(del).toContain('merchant_id = $1');
    expect(del).toContain('ledger > $2');

    // The cursor write must NOT carry setLastSyncedLedger's forward-only
    // guard: rewinding is the point of a rollback.
    const upsert = queries.find((q) => /^INSERT INTO sync_state/m.test(q))!;
    expect(upsert).toContain(
      'ON CONFLICT (merchant_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger',
    );
    expect(upsert).not.toContain('WHERE sync_state.last_ledger < EXCLUDED.last_ledger');

    expect(queries[queries.length - 1]).toBe('COMMIT');
    expect(queries.includes('ROLLBACK')).toBe(false);
  });

  it('rolls back the purge and the cursor write together on failure', async () => {
    const { client, queries } = fakeClient({ failDelete: true });

    await expect(rollbackSyncToLedger(client, 7, 5_000)).rejects.toThrow(
      'connection reset mid-delete',
    );
    expect(queries.includes('ROLLBACK')).toBe(true);
    expect(queries.includes('COMMIT')).toBe(false);
  });

  it('reports zero purged rows when nothing sat past the head', async () => {
    const { client } = fakeClient({ deleted: 0 });

    const result = await rollbackSyncToLedger(client, 7, 5_000);

    expect(result).toEqual({ purged: 0 });
  });
});
