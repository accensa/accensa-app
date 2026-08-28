import { describe, expect, test } from 'vitest';
import { mergePayments } from './page';

type P = Parameters<typeof mergePayments>[0][number];

const payment = (tx_hash: string, ts = '2026-03-10T00:00:00.000Z'): P => ({
  tx_hash,
  ledger: 1,
  payer: 'G' + 'A'.repeat(55),
  amount: '1.0000000',
  asset: null,
  ts,
  route: null,
  method: null,
});

describe('mergePayments (dashboard cursor pagination)', () => {
  test('appends older pages after the polled head, newest first', () => {
    const head = [payment('a', '2026-03-10T00:00:00Z'), payment('b', '2026-03-09T00:00:00Z')];
    const older = [payment('c', '2026-03-08T00:00:00Z'), payment('d', '2026-03-07T00:00:00Z')];
    expect(mergePayments(head, older).map((p) => p.tx_hash)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('de-duplicates by tx_hash when an older page overlaps the head', () => {
    // After a sync adds a new row to the head, the head can reach back into a
    // page already loaded below it.
    const head = [payment('new'), payment('a'), payment('b')];
    const older = [payment('b'), payment('c')];
    expect(mergePayments(head, older).map((p) => p.tx_hash)).toEqual(['new', 'a', 'b', 'c']);
  });

  test('the head wins on a duplicate, so the freshest row data is shown', () => {
    const stale = { ...payment('x'), route: null };
    const fresh = { ...payment('x'), route: '/api/quote' };
    const [row] = mergePayments([fresh], [stale]);
    expect(row.route).toBe('/api/quote');
  });

  test('empty inputs are handled', () => {
    expect(mergePayments([], [])).toEqual([]);
    expect(mergePayments([payment('a')], [])).toHaveLength(1);
  });
});
