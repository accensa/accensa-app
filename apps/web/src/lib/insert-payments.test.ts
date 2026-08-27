import { describe, it, expect, vi } from 'vitest';
import type { Client } from 'pg';
import type { RawEvent } from './stellar-events';
import fixture from './__fixtures__/sac-transfer-events.json';
import {
  PAYMENTS_BATCH_SIZE,
  buildBatchInsertSql,
  chunkRows,
  eventsToPaymentRows,
  flattenRows,
  insertPaymentsInTransaction,
  type PaymentRow,
} from './insert-payments';

const TX = (n: number) => n.toString(16).padStart(64, '0');
const PAYER = 'G' + 'A'.repeat(55);

function row(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    merchantId: 1,
    txHash: TX(1),
    ledger: 100,
    payer: PAYER,
    amount: '1000',
    asset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    ts: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/** Records every query; INSERT INTO payments returns `rows` RETURNING rows. */
function fakeClient(opts: {
  /** Throw on the nth INSERT INTO payments statement (1-based). */
  failInsertOn?: number;
  returning?: (sql: string) => Record<string, unknown>[];
}) {
  const queries: string[] = [];
  let insertCalls = 0;
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (/^INSERT INTO payments/m.test(sql)) {
        insertCalls++;
        if (opts.failInsertOn && insertCalls === opts.failInsertOn) {
          throw new Error('connection reset mid-batch');
        }
        const rows = opts.returning
          ? opts.returning(sql)
          : Array.from({ length: (sql.match(/\$\d+::numeric/g) ?? []).length }, (_, i) => ({
              tx_hash: TX(i),
              ledger: 100,
            }));
        return { rows, rowCount: rows.length };
      }
      if (/^SELECT pg_advisory_xact_lock/m.test(sql)) return { rows: [] };
      if (/^INSERT INTO sync_state/m.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
  return { client: client as unknown as Client, queries, insertCalls: () => insertCalls };
}

describe('chunkRows', () => {
  it('splits into size-bounded chunks, last one smaller', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for no rows', () => {
    expect(chunkRows([], 100)).toEqual([]);
  });
});

describe('buildBatchInsertSql', () => {
  it('builds one multi-row statement with 7 bind parameters per row', () => {
    const sql = buildBatchInsertSql(3);
    expect(sql.match(/\$\d+/g)).toHaveLength(21);
    // Three tuples, one per row (each carries one ::numeric cast).
    expect(sql.match(/\$\d+::numeric/g)).toHaveLength(3);
  });

  it('preserves ON CONFLICT DO UPDATE semantics and the ledger-NULL guard', () => {
    const sql = buildBatchInsertSql(2);
    expect(sql).toContain('ON CONFLICT (merchant_id, tx_hash) DO UPDATE');
    expect(sql).toContain('SET ledger = EXCLUDED.ledger');
    expect(sql).toContain('payer = EXCLUDED.payer');
    expect(sql).toContain('amount = EXCLUDED.amount');
    expect(sql).toContain('asset = EXCLUDED.asset');
    expect(sql).toContain('ts = EXCLUDED.ts');
    expect(sql).toContain('WHERE payments.ledger IS NULL');
    expect(sql).toContain('RETURNING *');
  });

  it('never writes merchant-reported columns', () => {
    const sql = buildBatchInsertSql(2);
    for (const col of ['route', 'method', 'request_id', 'hook_reported_at']) {
      expect(sql).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('flattenRows matches the placeholder order', () => {
    const r = row({ txHash: TX(7), ledger: 42, amount: '999' });
    expect(flattenRows([r])).toEqual([
      r.merchantId,
      r.txHash,
      r.ledger,
      r.payer,
      r.amount,
      r.asset,
      r.ts,
    ]);
  });
});

describe('eventsToPaymentRows — per-event filtering survives batching', () => {
  const validEvents = fixture.events as RawEvent[];

  it('keeps transfers addressed to this merchant and drops others', () => {
    const to = 'GD4C3LWGIXNDWC3G2UTIKXA4TN2KCBOCP5G6R6YT6WBHVDEP4D4GRMK4';
    const { rows, decoded } = eventsToPaymentRows(validEvents, { id: 1, address: to });

    expect(decoded).toBe(validEvents.length);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.merchantId === 1)).toBe(true);
    // Amount stays a decimal string — never a float.
    expect(typeof rows[0].amount).toBe('string');
  });

  it('skips malformed or non-transfer events without stalling the batch', () => {
    const to = 'GD4C3LWGIXNDWC3G2UTIKXA4TN2KCBOCP5G6R6YT6WBHVDEP4D4GRMK4';
    const events: RawEvent[] = [
      ...validEvents,
      { txHash: 'bad-1', ledger: 1 } as RawEvent, // no topic -> not decodable
      { value: { xdr: 'not-valid-xdr' } } as RawEvent, // malformed
    ];

    const { rows, decoded } = eventsToPaymentRows(events, { id: 1, address: to });
    expect(decoded).toBe(validEvents.length); // malformed ones not counted
    expect(rows.length).toBeGreaterThan(0); // valid ones still inserted
  });

  it('produces no rows when every transfer belongs to another merchant', () => {
    const other = 'G' + 'D'.repeat(55);
    const { rows } = eventsToPaymentRows(validEvents, { id: 2, address: other });
    expect(rows).toHaveLength(0);
  });

  it('carries ledger-owned fields into the row shape the insert expects', () => {
    const to = 'GD4C3LWGIXNDWC3G2UTIKXA4TN2KCBOCP5G6R6YT6WBHVDEP4D4GRMK4';
    const { rows } = eventsToPaymentRows(validEvents, { id: 1, address: to });
    const r = rows[0];
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.ledger).toBeGreaterThan(0);
    expect(r.payer.length).toBeGreaterThan(0);
    expect(r.ts).toBeTruthy();
    expect(() => new Date(r.ts)).not.toThrow();
  });
});

describe('insertPaymentsInTransaction', () => {
  it('inserts many rows in a single batched statement', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row({ txHash: TX(i) }));
    // No custom `returning`: the fake yields one RETURNING row per tuple, which
    // is what Postgres does for a batch that writes every row.
    const { client, queries } = fakeClient({});

    const result = await insertPaymentsInTransaction(client, 1, rows, 5000);

    // 250 rows at 100 per batch -> 3 INSERT statements (100/100/50).
    const inserts = queries.filter((q) => /^INSERT INTO payments/m.test(q));
    expect(inserts).toHaveLength(3);
    expect(inserts[0].match(/\$\d+/g)).toHaveLength(700);
    expect(inserts[1].match(/\$\d+/g)).toHaveLength(700);
    expect(inserts[2].match(/\$\d+/g)).toHaveLength(350);
    expect(result.inserted).toBe(250);
    expect(result.payments).toHaveLength(250);

    // Wrapped in a transaction, and the cursor advanced inside it.
    expect(queries[0]).toBe('BEGIN');
    expect(queries.some((q) => /^INSERT INTO sync_state/m.test(q))).toBe(true);
    expect(queries[queries.length - 1]).toBe('COMMIT');
    expect(queries.includes('ROLLBACK')).toBe(false);
  });

  it('advances the cursor across an empty run (no events, quiet merchant)', async () => {
    const { client, queries } = fakeClient({});
    const result = await insertPaymentsInTransaction(client, 1, [], 5000);

    expect(result.inserted).toBe(0);
    expect(queries).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock($1)',
      'INSERT INTO sync_state (merchant_id, last_ledger, updated_at) VALUES ($1, $2, now())\n     ON CONFLICT (merchant_id) DO UPDATE SET last_ledger = EXCLUDED.last_ledger, updated_at = now()\n     WHERE sync_state.last_ledger < EXCLUDED.last_ledger',
      'COMMIT',
    ]);
  });

  it('does not advance the cursor when a chunk fails mid-run', async () => {
    const rows = Array.from({ length: PAYMENTS_BATCH_SIZE * 2 + 1 }, (_, i) =>
      row({ txHash: TX(i) }),
    );
    const { client, queries } = fakeClient({ failInsertOn: 2 });

    await expect(insertPaymentsInTransaction(client, 1, rows, 5000)).rejects.toThrow(
      'connection reset mid-batch',
    );

    // The failed batch rolls everything back — including the cursor upsert,
    // which must never run for a run that did not commit.
    expect(queries[0]).toBe('BEGIN');
    expect(queries.includes('ROLLBACK')).toBe(true);
    expect(queries.includes('COMMIT')).toBe(false);
    expect(queries.some((q) => /^INSERT INTO sync_state/m.test(q))).toBe(false);
  });

  it('returns only the rows actually written (conflicts skipped by the guard are absent)', async () => {
    const rows = [row({ txHash: TX(1) }), row({ txHash: TX(2) })];
    const { client } = fakeClient({
      // Simulate one row already having a ledger (DO UPDATE ... WHERE ledger
      // IS NULL does not match): RETURNING yields only the other row.
      returning: (sql) => {
        const count = (sql.match(/\$\d+::numeric/g) ?? []).length;
        return count === 2 ? [{ tx_hash: TX(1), ledger: 100 }] : [];
      },
    });

    const result = await insertPaymentsInTransaction(client, 1, rows, 5000);
    expect(result.inserted).toBe(1);
    expect(result.payments).toEqual([{ tx_hash: TX(1), ledger: 100 }]);
  });
});
