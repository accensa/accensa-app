import { describe, it, expect, vi } from 'vitest';
import {
  isSettleMethod,
  toSettleHookPayload,
  toSettleMethod,
  SETTLE_ENDPOINT,
  SETTLE_METHODS,
  type SettleHookPayload,
} from '../settle-report';
import { reportSettlement } from '../../index';
import { AccensaContractError, AccensaNetworkError } from '../errors';
import type { Settlement } from '../../settlement';

/**
 * Runtime tests for the behaviour the OpenAPI spec constrains (#381).
 *
 * The generated types themselves are checked in `api-types.test-d.ts`, which
 * runs `tsc` as part of `pnpm test`; the split matters, because the two halves
 * of this module fail in different ways:
 *
 *  - **Types.** `SettleHookPayload` is *the same type* as the spec's
 *    `SettlementReport`, and the builder returns an object literal of that
 *    type, so the compiler already refuses a field the spec does not declare
 *    or misses one it requires. Re-parsing `generated/api-types.ts` at runtime
 *    to check the same thing would be a brittle copy of a guarantee the type
 *    system already gives, so it is not done here.
 *  - **Values.** What the type system cannot see is everything that survives
 *    only at runtime: the method list (an array, not a type), which optional
 *    fields actually reach the wire, and what happens when a settlement
 *    violates the spec. Those are what these tests cover.
 *
 * The end of the contract is the indexer's own validator
 * (`apps/web/src/lib/settlement-report.ts`); `apps/web`'s test suite asserts
 * the method list here and the server's list agree, so this file does not
 * reach across the package boundary to do it a second time.
 */

/** A settlement with only the fields the indexer cannot do without. */
function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    txHash: 'b'.repeat(64),
    route: '/api/v1/pay',
    method: 'POST',
    ...overrides,
  };
}

/** The exact field set `apps/web/openapi.yaml` documents for SettlementReport. */
const SPEC_FIELDS = [
  'tx_hash',
  'route',
  'method',
  'request_id',
  'payer',
  'amount',
  'network',
  'reported_at',
] as const;

/** The subset the indexer rejects a report without. */
const SPEC_REQUIRED_FIELDS = ['tx_hash', 'route', 'method'] as const;

describe('SETTLE_METHODS — the method enum the spec declares, at runtime', () => {
  it('is exactly the seven methods the spec enumerates', () => {
    // The spec's enum. `api-types.test-d.ts` asserts this array's element
    // type is the spec's `SettlementReport['method']`; this asserts the list
    // itself has no duplicates and nothing the spec would not accept.
    expect([...SETTLE_METHODS].sort()).toEqual([
      'DELETE',
      'GET',
      'HEAD',
      'OPTIONS',
      'PATCH',
      'POST',
      'PUT',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(SETTLE_METHODS).size).toBe(SETTLE_METHODS.length);
  });

  it('is uppercase, because the spec enumerates uppercase', () => {
    for (const method of SETTLE_METHODS) {
      expect(method).toBe(method.toUpperCase());
    }
  });

  it('narrows only the methods the indexer accepts', () => {
    for (const method of SETTLE_METHODS) expect(isSettleMethod(method)).toBe(true);
  });

  it.each(['trace', 'connect', 'get', 'post', 'GET ', '', 'GET,POST'])(
    'does not narrow %j, which the indexer would reject',
    (candidate) => {
      expect(isSettleMethod(candidate)).toBe(false);
    },
  );
});

describe('toSettleMethod — normalizing before the report is signed', () => {
  it('accepts every method the spec enumerates', () => {
    for (const method of SETTLE_METHODS) {
      expect(toSettleMethod(method)).toBe(method);
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    // `Settlement.method` is whatever the merchant's router saw. Express
    // upper-cases it, but a hand-rolled adapter need not, and the indexer's
    // validator is case-sensitive.
    expect(toSettleMethod('post')).toBe('POST');
    expect(toSettleMethod('  get  ')).toBe('GET');
  });

  it('rejects a method the spec does not enumerate, naming it', () => {
    let thrown: unknown;
    try {
      toSettleMethod('PROPFIND');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AccensaContractError);
    expect((thrown as Error).message).toContain('PROPFIND');
    // The message has to say what *is* allowed, or the reader has to go and
    // look the enum up in the spec to find their typo.
    for (const method of SETTLE_METHODS) {
      expect((thrown as Error).message).toContain(method);
    }
  });

  it.each(['', '   ', 'get post', 'GE T'])('rejects %j rather than guessing', (candidate) => {
    expect(() => toSettleMethod(candidate)).toThrow(AccensaContractError);
  });
});

describe('toSettleHookPayload — the body the spec documents', () => {
  it('emits exactly the fields the spec declares, and no others', () => {
    const payload = toSettleHookPayload(
      settlement({ requestId: 'r1', payer: 'GABC', amount: '1.5', network: 'testnet' }),
    );
    expect(Object.keys(payload).sort()).toEqual([...SPEC_FIELDS].sort());
  });

  it('always populates the fields the indexer requires', () => {
    // `parseSettlementReport` rejects a report missing any of these, so a
    // payload missing one is a report that can only ever 400.
    const payload = toSettleHookPayload(settlement());
    for (const field of SPEC_REQUIRED_FIELDS) {
      expect(payload[field], field).toBeTruthy();
    }
  });

  it('omits the optional fields a settlement did not carry', () => {
    // `Settlement.requestId` and friends are optional, so they arrive as
    // `undefined`; the signed body must not contain the keys at all, because
    // `null` and `undefined` are different things to a validator.
    const wire = JSON.parse(JSON.stringify(toSettleHookPayload(settlement()))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(wire).sort()).toEqual([...SPEC_REQUIRED_FIELDS, 'reported_at'].sort());
    for (const omitted of ['request_id', 'payer', 'amount', 'network']) {
      expect(wire, omitted).not.toHaveProperty(omitted);
    }
  });

  it('carries an optional field through when the settlement has one', () => {
    const payload = toSettleHookPayload(settlement({ amount: '1500000' }));
    expect(payload.amount).toBe('1500000');
  });

  it('stamps reported_at as an ISO-8601 instant', () => {
    // The spec types it `string` with `format: date-time`, and the indexer
    // parses it with `new Date(...)`; a local-time string would parse and
    // then be the wrong moment.
    const { reported_at } = toSettleHookPayload(settlement());
    expect(reported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(reported_at).getTime())).toBe(false);
  });

  it('reports the method in the form the indexer validates', () => {
    expect(toSettleHookPayload(settlement({ method: 'get' })).method).toBe('GET');
  });

  it('refuses to build a body the indexer is bound to reject', () => {
    // Fail before the bytes are signed: a body that is already wrong should
    // not cost a network round trip to find out.
    expect(() => toSettleHookPayload(settlement({ method: 'PROPFIND' }))).toThrow(
      AccensaContractError,
    );
  });
});

describe('reportSettlement — a spec violation never reaches the network', () => {
  it('resolves false and reports through onError, without a request', async () => {
    const fetchImpl = vi.fn();
    const onError = vi.fn();

    await expect(
      reportSettlement(settlement({ method: 'PROPFIND' }), {
        indexerUrl: 'https://accensa.test',
        privateKeyHex: 'a'.repeat(64),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onError,
      }),
    ).resolves.toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0] as [Error];
    expect(error).toBeInstanceOf(AccensaContractError);
    expect(error.message).toContain('PROPFIND');
    expect(error.message).toContain(SETTLE_ENDPOINT);
  });

  it('reports the failure as a contract error, not as a network error', async () => {
    // Mislabeling this as a network problem sends the reader to check
    // connectivity, which is fine, rather than to look at the method their
    // `attribute` callback returned.
    const onError = vi.fn();
    await reportSettlement(settlement({ method: '' }), {
      indexerUrl: 'https://accensa.test',
      privateKeyHex: 'a'.repeat(64),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      onError,
    });

    const [error] = onError.mock.calls[0] as [Error];
    expect(error).toBeInstanceOf(AccensaContractError);
    expect(error).not.toBeInstanceOf(AccensaNetworkError);
    expect((error as { name: string }).name).toBe('AccensaContractError');
  });

  it('still reports a valid settlement', async () => {
    // The guard above must not have cost the happy path.
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const onError = vi.fn();

    await expect(
      reportSettlement(settlement(), {
        indexerUrl: 'https://accensa.test',
        privateKeyHex: 'a'.repeat(64),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onError,
      }),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    const body = fetchImpl.mock.calls[0][1]?.body as string;
    const sent = JSON.parse(body) as SettleHookPayload;
    expect(Object.keys(sent).sort()).toEqual([...SPEC_REQUIRED_FIELDS, 'reported_at'].sort());
  });
});
