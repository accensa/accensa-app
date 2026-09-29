import { describe, it, expect } from 'vitest';
import { HttpError } from '../retry';
import {
  AccensaAuthError,
  AccensaContractError,
  AccensaError,
  AccensaNetworkError,
} from './errors';
import {
  SETTLE_ENDPOINT,
  settleEndpointUrl,
  toSettleHookPayload,
  toSettleReportError,
} from './settle-report';

const TX = 'a'.repeat(64);
const SETTLE_URL = `https://accensa.test${SETTLE_ENDPOINT}`;
const httpError = (status: number) => new HttpError(new Response(null, { status }));

/** A settlement with only the fields the indexer cannot do without. */
const settlement = (overrides: Partial<Parameters<typeof toSettleHookPayload>[0]> = {}) => ({
  txHash: TX,
  route: '/api/v1/pay',
  method: 'POST',
  ...overrides,
});

describe('settleEndpointUrl', () => {
  it('appends the settle endpoint', () => {
    expect(settleEndpointUrl('https://accensa.test')).toBe(SETTLE_URL);
  });

  it('does not double a trailing slash', () => {
    expect(settleEndpointUrl('https://accensa.test/')).toBe(SETTLE_URL);
  });
});

describe('toSettleHookPayload', () => {
  it('maps a settlement onto the wire field names', () => {
    // Every key is snake_cased on the wire, and the mapping is the whole
    // reason this function exists: the spec, not the in-process names, decides
    // what goes on the wire.
    const payload = toSettleHookPayload(
      settlement({ requestId: 'req-1', payer: 'GABC', amount: '10', network: 'testnet' }),
    );
    expect(payload).toMatchObject({
      tx_hash: TX,
      route: '/api/v1/pay',
      method: 'POST',
      request_id: 'req-1',
      payer: 'GABC',
      amount: '10',
      network: 'testnet',
    });
  });

  it('leaves optional fields undefined so they are dropped from the signed body', () => {
    const payload = toSettleHookPayload(settlement());
    expect(payload.request_id).toBeUndefined();
    expect(payload.payer).toBeUndefined();
    expect(payload.amount).toBeUndefined();
    expect(payload.network).toBeUndefined();
  });

  it('normalizes the method before signing', () => {
    expect(toSettleHookPayload(settlement({ method: ' put ' })).method).toBe('PUT');
  });
});

describe('toSettleReportError', () => {
  it.each([401, 403])('classifies %i as an auth error with status and path', (status) => {
    const error = toSettleReportError(httpError(status), TX, SETTLE_URL);
    expect(error).toBeInstanceOf(AccensaAuthError);
    expect(error).toMatchObject({ status, path: SETTLE_ENDPOINT });
    expect(error.message).toBe(`Accensa returned ${status} for ${TX}`);
  });

  it.each([400, 404, 500, 503])('classifies %i as a plain AccensaError', (status) => {
    const error = toSettleReportError(httpError(status), TX, SETTLE_URL);
    expect(error.constructor).toBe(AccensaError);
    expect(error.status).toBe(status);
  });

  it('wraps a thrown Error as a network error carrying the SETTLE_URL and cause', () => {
    const cause = new Error('ECONNRESET');
    const error = toSettleReportError(cause, TX, SETTLE_URL);
    expect(error).toBeInstanceOf(AccensaNetworkError);
    expect(error).toMatchObject({ url: SETTLE_URL, cause });
    expect(error.message).toContain('ECONNRESET');
  });

  it('stringifies a non-Error rejection into the message', () => {
    const error = toSettleReportError('socket hang up', TX, SETTLE_URL);
    expect(error).toBeInstanceOf(AccensaNetworkError);
    expect(error.message).toContain('socket hang up');
  });

  it('passes an AccensaError through unchanged, keeping its classification', () => {
    // Building the report can fail before anything is sent. Reporting that as
    // a network error would send the reader to check connectivity instead of
    // looking at the method they attributed the payment to.
    const contract = new AccensaContractError('bad method');
    const error = toSettleReportError(contract, TX, SETTLE_URL);
    expect(error).toBe(contract);
    expect(error).toBeInstanceOf(AccensaContractError);
    expect(error).not.toBeInstanceOf(AccensaNetworkError);
  });

  it('still classifies an auth error that reaches it as an auth error', () => {
    const auth = new AccensaAuthError('nope', { status: 401, path: SETTLE_ENDPOINT });
    expect(toSettleReportError(auth, TX, SETTLE_URL)).toBe(auth);
  });
});
