import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  validateDisputeRequest,
  estimateDisputeFee,
  mapDisputeReason,
  DisputeReason,
  type DisputeRequest,
  type DisputeOptions,
} from './index';
import { AccensaContractError } from '../errors';

const VALID_TX_HASH = 'a'.repeat(64);
const VALID_REQUEST: DisputeRequest = {
  txHash: VALID_TX_HASH,
  refundAmount: '100.0000000',
  reason: DisputeReason.NON_DELIVERY,
  description: 'Item never arrived at my address.',
};
const OPTS: DisputeOptions = { contractId: 'CCDEF...' };
const NOW = new Date('2026-06-15T12:00:00Z');
const RECENT_DATE = '2026-06-10T00:00:00Z'; // 5 days before NOW

afterEach(() => {
  vi.useRealTimers();
});

describe('validateDisputeRequest', () => {
  it('accepts a valid request within the dispute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const result = validateDisputeRequest(VALID_REQUEST, RECENT_DATE);
    expect(result).toEqual({ valid: true });
  });

  it('rejects an invalid transaction hash (too short)', () => {
    const result = validateDisputeRequest({ ...VALID_REQUEST, txHash: 'abc' }, RECENT_DATE);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid transaction hash format');
  });

  it('rejects a tx hash with non-hex characters', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, txHash: 'z'.repeat(64) },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid transaction hash format');
  });

  it('rejects an invalid refund amount format (letters)', () => {
    const result = validateDisputeRequest({ ...VALID_REQUEST, refundAmount: 'abc' }, RECENT_DATE);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid refund amount format');
  });

  it('rejects a refund amount with more than 7 decimal places', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, refundAmount: '1.00000001' },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid refund amount format');
  });

  it('rejects a zero refund amount', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, refundAmount: '0.0000000' },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Refund amount must be greater than zero');
  });

  it('rejects a negative refund amount', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, refundAmount: '-1.0000000' },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid refund amount format');
  });

  it('rejects an invalid dispute reason', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, reason: 99 as DisputeReason },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid dispute reason');
  });

  it('rejects a description that is too short', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, description: 'Too short' },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Description must be at least 10 characters');
  });

  it('rejects a description that is too long', () => {
    const result = validateDisputeRequest(
      { ...VALID_REQUEST, description: 'x'.repeat(501) },
      RECENT_DATE,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Description must not exceed 500 characters');
  });

  it('rejects a request outside the dispute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const oldDate = '2026-05-01T00:00:00Z'; // >30 days before NOW
    const result = validateDisputeRequest(VALID_REQUEST, oldDate, 30);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Dispute window of 30 days has expired');
  });

  it('rejects an unparseable transaction date (NaN guard)', () => {
    const result = validateDisputeRequest(VALID_REQUEST, 'not-a-date');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid transaction date');
  });

  it('validates does not throw — returns { valid, error } instead', () => {
    expect(() =>
      validateDisputeRequest({ ...VALID_REQUEST, txHash: 'bad' }, RECENT_DATE),
    ).not.toThrow();
  });
});

describe('estimateDisputeFee', () => {
  it('returns 10100 (base 100 + contract 10000)', () => {
    const fee = estimateDisputeFee(OPTS);
    expect(fee).toBe(10100);
  });

  it('ignores opts beyond contractId', () => {
    const feeA = estimateDisputeFee({ contractId: 'A' });
    const feeB = estimateDisputeFee({ contractId: 'B', disputeWindowDays: 90 });
    expect(feeA).toBe(feeB);
  });
});

describe('mapDisputeReason', () => {
  it('maps non_delivery to NON_DELIVERY', () => {
    expect(mapDisputeReason('non_delivery')).toBe(DisputeReason.NON_DELIVERY);
  });

  it('maps defective_goods to DEFECTIVE_GOODS', () => {
    expect(mapDisputeReason('defective_goods')).toBe(DisputeReason.DEFECTIVE_GOODS);
  });

  it('maps unauthorized_charge to UNAUTHORIZED_CHARGE', () => {
    expect(mapDisputeReason('unauthorized_charge')).toBe(DisputeReason.UNAUTHORIZED_CHARGE);
  });

  it('throws AccensaContractError for an unknown reason', () => {
    expect(() => mapDisputeReason('something_else')).toThrow(AccensaContractError);
  });

  it('thrown error message contains the bad reason', () => {
    expect(() => mapDisputeReason('bad_reason')).toThrow('bad_reason');
  });
});
