import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPayments } from './diff.mjs';

function row(overrides = {}) {
  return {
    tx_hash: 'a'.repeat(64),
    ledger: 100,
    payer: 'GPAYER',
    amount: '5.0000000',
    asset: 'native',
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('identical rows match, and route/method/request_id are never inspected', () => {
  const chainRow = row();
  const dbRow = { ...row(), route: '/api/premium', method: 'GET', request_id: 'req-1' };
  const result = diffPayments(
    new Map([[chainRow.tx_hash, chainRow]]),
    new Map([[dbRow.tx_hash, dbRow]]),
  );
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched.length, 0);
  assert.equal(result.ok, true);
});

test('matching row count with a mismatched amount is caught, not hidden by the count', () => {
  const txHash = 'b'.repeat(64);
  const chain = new Map([[txHash, row({ tx_hash: txHash, amount: '5.0000000' })]]);
  const production = new Map([[txHash, row({ tx_hash: txHash, amount: '50.0000000' })]]);

  const result = diffPayments(chain, production);
  assert.equal(result.matched, 0);
  assert.equal(result.mismatched.length, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatched[0].columns.amount, { chain: '5.0000000', db: '50.0000000' });
});

test('a row on chain but absent from the database is reported as missing_in_db', () => {
  const txHash = 'c'.repeat(64);
  const chain = new Map([[txHash, row({ tx_hash: txHash })]]);
  const result = diffPayments(chain, new Map());
  assert.equal(result.missingInDb.length, 1);
  assert.equal(result.missingInDb[0].tx_hash, txHash);
  assert.equal(result.ok, false);
});

test('a database row with a ledger that the rebuild never saw is missing_on_chain', () => {
  const txHash = 'd'.repeat(64);
  const production = new Map([[txHash, row({ tx_hash: txHash })]]);
  const result = diffPayments(new Map(), production);
  assert.equal(result.missingOnChain.length, 1);
  assert.equal(result.ok, false);
});

test('a merchant-staged row (null ledger, not yet indexed) is pending, not a failure', () => {
  const txHash = 'e'.repeat(64);
  const production = new Map([
    [txHash, { tx_hash: txHash, ledger: null, payer: null, amount: null, asset: null, ts: null }],
  ]);
  const result = diffPayments(new Map(), production);
  assert.equal(result.pendingOnChain.length, 1);
  assert.equal(result.missingOnChain.length, 0);
  assert.equal(result.ok, true);
});

test('ledger compared numerically regardless of string/number type from Postgres', () => {
  const txHash = 'f'.repeat(64);
  const chain = new Map([[txHash, row({ tx_hash: txHash, ledger: 42 })]]);
  const production = new Map([[txHash, row({ tx_hash: txHash, ledger: '42' })]]);
  const result = diffPayments(chain, production);
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched.length, 0);
});

test('amounts differing only by trailing fractional zeros are not mismatches', () => {
  const cases = [
    ['5.0000000', '5'],
    ['10.5000000', '10.5'],
    ['10.5000000', '10.50'],
    ['0.0000000', '0.0'],
    ['0.0000000', '0'],
    ['-2.2500000', '-2.25'],
    ['123456789012345.1000000', '123456789012345.1'],
  ];

  for (const [chainAmount, dbAmount] of cases) {
    const txHash = 'b1'.padEnd(64, '0');
    const chain = new Map([[txHash, row({ tx_hash: txHash, amount: chainAmount })]]);
    const production = new Map([[txHash, row({ tx_hash: txHash, amount: dbAmount })]]);
    const result = diffPayments(chain, production);
    assert.equal(result.matched, 1, `${chainAmount} should match ${dbAmount}`);
    assert.equal(result.mismatched.length, 0);
    assert.equal(result.ok, true);
  }
});

test('genuinely different amounts are still flagged despite zero padding', () => {
  const txHash = 'b2'.padEnd(64, '0');
  const chain = new Map([[txHash, row({ tx_hash: txHash, amount: '10.5000000' })]]);
  const production = new Map([[txHash, row({ tx_hash: txHash, amount: '10.51' })]]);
  const result = diffPayments(chain, production);
  assert.equal(result.matched, 0);
  assert.equal(result.mismatched.length, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatched[0].columns.amount, { chain: '10.5000000', db: '10.51' });
});

test('a mismatch in another column does not also report an equivalent amount', () => {
  const txHash = 'b3'.padEnd(64, '0');
  const chain = new Map([[txHash, row({ tx_hash: txHash, amount: '10.5000000' })]]);
  const production = new Map([[txHash, row({ tx_hash: txHash, amount: '10.5', payer: 'GOTHER' })]]);
  const result = diffPayments(chain, production);
  assert.equal(result.mismatched.length, 1);
  assert.deepEqual(Object.keys(result.mismatched[0].columns), ['payer']);
});

test('ts compared by instant, tolerant of formatting differences', () => {
  const txHash = 'a1'.padEnd(64, '0');
  const chain = new Map([[txHash, row({ tx_hash: txHash, ts: '2026-01-01T00:00:00.000Z' })]]);
  const production = new Map([[txHash, row({ tx_hash: txHash, ts: '2026-01-01T00:00:00+00:00' })]]);
  const result = diffPayments(chain, production);
  assert.equal(result.matched, 1);
});
