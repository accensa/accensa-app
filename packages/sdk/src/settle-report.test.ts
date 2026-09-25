import { describe, it, expect } from 'vitest';
import { HttpError } from '../retry';
import { AccensaAuthError, AccensaError, AccensaNetworkError } from './errors';
import { SETTLE_ENDPOINT, settleEndpointUrl, toSettleReportError } from './settle-report';

const TX = 'a'.repeat(64);
const SETTLE_URL = `https://accensa.test${SETTLE_ENDPOINT}`;
const httpError = (status: number) => new HttpError(new Response(null, { status }));

describe('settleEndpointUrl', () => {
  it('appends the settle endpoint', () => {
    expect(settleEndpointUrl('https://accensa.test')).toBe(SETTLE_URL);
  });

  it('does not double a trailing slash', () => {
    expect(settleEndpointUrl('https://accensa.test/')).toBe(SETTLE_URL);
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
});
