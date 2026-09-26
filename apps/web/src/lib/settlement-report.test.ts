import { describe, it, expect } from 'vitest';
import { SETTLE_METHODS, isSettleMethod } from '@accensa/sdk';
import { parseSettlementReport } from './settlement-report';

const TX = 'a'.repeat(64);
const PAYER = 'G' + 'A'.repeat(55);

const valid = { tx_hash: TX, route: '/api/hello', method: 'GET' };

function expectError(body: unknown, match: RegExp) {
  const result = parseSettlementReport(body);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(match);
}

describe('parseSettlementReport', () => {
  it('accepts a minimal valid report without reported_at during transition window', () => {
    const result = parseSettlementReport(valid);
    expect(result).toEqual({
      ok: true,
      report: {
        txHash: TX,
        route: '/api/hello',
        method: 'GET',
        requestId: null,
        payer: null,
        reportedAt: null,
      },
    });
  });

  it('accepts a valid report with reported_at', () => {
    const date = new Date().toISOString();
    const result = parseSettlementReport({ ...valid, reported_at: date });
    expect(result).toEqual({
      ok: true,
      report: {
        txHash: TX,
        route: '/api/hello',
        method: 'GET',
        requestId: null,
        payer: null,
        reportedAt: date,
      },
    });
  });

  it('lower-cases the transaction hash so lookups match the indexer', () => {
    const result = parseSettlementReport({ ...valid, tx_hash: TX.toUpperCase() });
    expect(result.ok && result.report.txHash).toBe(TX);
  });

  it('upper-cases the method', () => {
    const result = parseSettlementReport({ ...valid, method: 'post' });
    expect(result.ok && result.report.method).toBe('POST');
  });

  it('carries through an optional request id and payer', () => {
    const result = parseSettlementReport({ ...valid, request_id: 'req-9', payer: PAYER });
    expect(result.ok && result.report).toMatchObject({ requestId: 'req-9', payer: PAYER });
  });

  it('treats a blank request id as absent', () => {
    const result = parseSettlementReport({ ...valid, request_id: ' ' });
    expect(result.ok && result.report.requestId).toBeNull();
  });

  it.each([
    ['a string', 'nope'],
    ['null', null],
    ['an array', []],
  ])('rejects a body that is %s', (_label, body) => {
    expectError(body, /JSON object/);
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['not hex', 'z'.repeat(64)],
    ['not a string', 12345],
  ])('rejects a tx_hash that is %s', (_label, tx_hash) => {
    expectError({ ...valid, tx_hash }, /tx_hash/);
  });

  // The reason this endpoint exists: mock hashes must never reach the database.
  it('rejects a fabricated mock hash', () => {
    expectError({ ...valid, tx_hash: `mock_hash_${Date.now()}` }, /tx_hash/);
  });

  it('rejects a missing route', () => {
    expectError({ tx_hash: TX, method: 'GET' }, /route is required/);
  });

  it('rejects an over-long route rather than truncating it', () => {
    expectError({ ...valid, route: '/' + 'a'.repeat(255) }, /at most 255/);
  });

  it('rejects an over-long request id rather than truncating it', () => {
    expectError({ ...valid, request_id: 'r'.repeat(65) }, /at most 64/);
  });

  it.each([['TRACE'], ['CONNECT'], ['nonsense'], ['']])('rejects the method %s', (method) => {
    expectError({ ...valid, method }, /method/);
  });

  it('rejects a payer that is not a Stellar account id', () => {
    expectError({ ...valid, payer: 'not-an-account' }, /Stellar account/);
  });

  it('rejects a non-string request id', () => {
    expectError({ ...valid, request_id: 5 }, /request_id/);
  });

  it('rejects a non-string reported_at', () => {
    expectError({ ...valid, reported_at: 123 }, /reported_at must be a string/);
  });

  it('rejects a malformed timestamp for reported_at', () => {
    expectError({ ...valid, reported_at: 'not-a-date' }, /ISO-8601 timestamp/);
  });

  it('rejects a stale reported_at', () => {
    const staleDate = new Date(Date.now() - 4000000).toISOString();
    expectError({ ...valid, reported_at: staleDate }, /report_too_old/);
  });

  it('rejects a future-dated reported_at', () => {
    const futureDate = new Date(Date.now() + 600000).toISOString();
    expectError({ ...valid, reported_at: futureDate }, /report_future_dated/);
  });
});

/**
 * Client/server parity for the method list (#381).
 *
 * Two lists have to agree for a settlement to be recordable: the SDK's
 * `SETTLE_METHODS` (derived from the `method` enum in `openapi.yaml`, which
 * is what the SDK validates against before signing) and the `METHODS` set
 * this validator enforces. Nothing links them at the type level - one is in
 * `@accensa/sdk`, the other is a `Set` two directories away - so a method
 * added to one and not the other is invisible until a merchant reports a paid
 * request with that verb and the hook silently drops it.
 *
 * The pairing is asserted in both directions: every method the SDK will sign
 * is accepted here, and every method accepted here is one the SDK will sign.
 */
describe('method parity with @accensa/sdk', () => {
  it('accepts every method the SDK is willing to report', () => {
    for (const method of SETTLE_METHODS) {
      const result = parseSettlementReport({ ...valid, method });
      expect(result.ok, `${method} should be accepted`).toBe(true);
      expect(result.ok && result.report.method).toBe(method);
    }
  });

  it('rejects a method the SDK itself refuses to sign', () => {
    // A method outside the SDK's list can never be reported, so it must not
    // be accepted here either - otherwise a merchant's own `attribute`
    // callback is the only thing standing between a bad verb and the database.
    expect(isSettleMethod('TRACE')).toBe(false);
    expectError({ ...valid, method: 'TRACE' }, /method/);
  });

  it('agrees on the exact set, in both directions', () => {
    // Compare behaviour to behaviour over a candidate list that covers every
    // method either side knows about, so the assertion does not restate either
    // list and go stale.
    const candidates = [...SETTLE_METHODS, 'TRACE', 'CONNECT', 'PROPFIND', 'PROPPATCH'];
    const acceptedHere = candidates.filter(
      (method) => parseSettlementReport({ ...valid, method }).ok,
    );
    const acceptedBySdk = candidates.filter((method) => isSettleMethod(method));

    expect(acceptedHere).toEqual(acceptedBySdk);
  });
});
