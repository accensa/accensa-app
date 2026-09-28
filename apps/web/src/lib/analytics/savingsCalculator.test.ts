import { describe, expect, it } from 'vitest';
import {
  accensaProcessingFee,
  DEFAULT_CARD_BENCHMARK,
  formatSavings,
  netSavingsForTransaction,
  savingsMilestone,
  STELLAR_BASE_FEE_STROOPS,
  summarizeSavings,
  traditionalProcessingFee,
  type SettledTransaction,
} from './savingsCalculator';

describe('traditionalProcessingFee', () => {
  it('charges 2.9% + 30¢ on a small ($1) transaction', () => {
    // 2.9% of 1.00 = 0.029, plus 0.30 fixed = 0.329 exactly.
    expect(traditionalProcessingFee('1')).toBe('0.3290000');
  });

  it('charges 2.9% + 30¢ on a large ($5,000) transaction', () => {
    // 2.9% of 5,000 = 145, plus 0.30 fixed = 145.30 exactly.
    expect(traditionalProcessingFee('5000')).toBe('145.3000000');
  });

  it('scales the variable part with amount while the fixed part stays flat', () => {
    const small = traditionalProcessingFee('10');
    const large = traditionalProcessingFee('1000');
    // 0.29 + 0.30 = 0.59 vs 29 + 0.30 = 29.30: the fixed 0.30 is identical in both.
    expect(small).toBe('0.5900000');
    expect(large).toBe('29.3000000');
  });

  it('supports a configurable benchmark', () => {
    const fee = traditionalProcessingFee('100', { percent: '0.015', fixed: '0.10' });
    expect(fee).toBe('1.6000000');
  });

  it('rejects malformed amounts and benchmarks', () => {
    expect(() => traditionalProcessingFee('not-a-number')).toThrow();
    expect(() => traditionalProcessingFee('1', { percent: 'abc', fixed: '0.30' })).toThrow();
    expect(() => traditionalProcessingFee('1', { percent: '0.029', fixed: '-1' })).toThrow();
  });
});

describe('accensaProcessingFee', () => {
  it('defaults to the Stellar base fee alone (100 stroops)', () => {
    expect(accensaProcessingFee('1')).toBe('0.0000100');
    expect(STELLAR_BASE_FEE_STROOPS).toBe(100n);
  });

  it('adds a protocol fee and scales with operation count', () => {
    expect(accensaProcessingFee('1', { protocolFee: '0.001' })).toBe('0.0010100');
    expect(accensaProcessingFee('1', { networkFeeStroops: 100n, operations: 3 })).toBe('0.0000300');
  });

  it('rejects invalid options', () => {
    expect(() => accensaProcessingFee('1', { protocolFee: 'x' })).toThrow();
    expect(() => accensaProcessingFee('1', { operations: 0 })).toThrow();
    expect(() => accensaProcessingFee('1', { networkFeeStroops: -1n })).toThrow();
  });
});

describe('netSavingsForTransaction', () => {
  it('saves the full benchmark minus network fee on a $1 transaction', () => {
    const savings = netSavingsForTransaction('1');
    expect(savings.traditionalFee).toBe('0.3290000');
    expect(savings.accensaFee).toBe('0.0000100');
    expect(savings.netSavings).toBe('0.3289900');
  });

  it('saves the full benchmark minus network fee on a $5,000 transaction', () => {
    const savings = netSavingsForTransaction('5000');
    expect(savings.traditionalFee).toBe('145.3000000');
    expect(savings.accensaFee).toBe('0.0000100');
    expect(savings.netSavings).toBe('145.2999900');
  });

  it('floors savings at zero when the benchmark is below the actual fee', () => {
    const savings = netSavingsForTransaction('1', { percent: '0', fixed: '0' });
    expect(savings.netSavings).toBe('0.0000000');
  });
});

describe('summarizeSavings', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15T12:00:00Z

  const tx = (amount: string, ts: string): SettledTransaction => ({ amount, ts });

  it('splits all-time totals from the current calendar month', () => {
    const summary = summarizeSavings(
      [
        tx('1', '2026-09-20T10:00:00Z'), // this month
        tx('5000', '2026-09-01T00:00:00Z'), // this month
        tx('100', '2026-08-31T23:59:59Z'), // last month
      ],
      { now },
    );

    expect(summary.transactionCount).toBe(3);
    expect(summary.monthTransactionCount).toBe(2);
    // This month: 0.32899 + 145.29999 = 145.62898
    expect(summary.monthSavings).toBe('145.6289800');
    // All time adds August's 100 * 0.029 + 0.30 - 0.00001 = 3.19999
    expect(summary.totalSavings).toBe('148.8289700');
    expect(summary.monthTraditionalTotal).toBe('145.6290000');
    expect(summary.monthActualTotal).toBe('0.0000200');
  });

  it('counts but does not sum transactions with unreadable amounts', () => {
    const summary = summarizeSavings([tx('1', '2026-09-10T00:00:00Z'), tx('', 'bogus')], { now });
    expect(summary.transactionCount).toBe(2);
    expect(summary.monthTransactionCount).toBe(1);
    expect(summary.monthSavings).toBe('0.3289900');
  });

  it('returns zeroed totals for no transactions', () => {
    const summary = summarizeSavings([], { now });
    expect(summary.monthSavings).toBe('0.0000000');
    expect(summary.totalSavings).toBe('0.0000000');
    expect(summary.monthTransactionCount).toBe(0);
  });
});

describe('savingsMilestone', () => {
  it('reports the highest milestone reached', () => {
    expect(savingsMilestone('99.99')).toBeNull();
    expect(savingsMilestone('100')).toBe(100);
    expect(savingsMilestone('999.99')).toBe(500);
    expect(savingsMilestone('10000')).toBe(10000);
    expect(savingsMilestone('25000')).toBe(10000);
  });
});

describe('formatSavings', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatSavings('0.32899')).toBe('$0.33');
    expect(formatSavings('145.29999')).toBe('$145.30');
    expect(formatSavings('1234567.891')).toBe('$1,234,567.89');
  });

  it('falls back to $0.00 for unparseable input', () => {
    expect(formatSavings('nope')).toBe('$0.00');
  });
});

describe('default benchmark', () => {
  it('is the standard Stripe/Visa online rate', () => {
    expect(DEFAULT_CARD_BENCHMARK).toEqual({ percent: '0.029', fixed: '0.30' });
  });
});
