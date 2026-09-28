import { describe, expect, it } from 'vitest';
import {
  aggregateGasFees,
  formatFeeToVolumeRatio,
  gasCsvExport,
  gasLogToCsv,
  parseGasFeeLogEntry,
  stroopsToXlm,
  traditionalCardFeeForVolume,
  type GasFeeLogEntry,
} from './gasCalculator';

const entry = (
  txHash: string,
  feeStroops: bigint,
  timestamp: string,
  amount = '10',
): GasFeeLogEntry => ({ txHash, ledger: 42, feeStroops, timestamp, amount });

describe('parseGasFeeLogEntry', () => {
  it('parses a receipt with a numeric or string fee', () => {
    const fromNumber = parseGasFeeLogEntry({
      txHash: 'a'.repeat(64),
      ledger: 42,
      fee: 100,
      timestamp: '2026-09-01T10:00:00Z',
      amount: '10',
    });
    expect(fromNumber.feeStroops).toBe(100n);
    expect(fromNumber.ledger).toBe(42);

    const fromString = parseGasFeeLogEntry({
      txHash: 'a'.repeat(64),
      fee: '250',
      timestamp: '2026-09-01T10:00:00Z',
    });
    expect(fromString.feeStroops).toBe(250n);
    expect(fromString.amount).toBeNull();
  });

  it('rejects malformed receipts', () => {
    expect(() => parseGasFeeLogEntry({ fee: 100, timestamp: '2026-09-01T10:00:00Z' })).toThrow();
    expect(() =>
      parseGasFeeLogEntry({ txHash: 'a'.repeat(64), fee: -5, timestamp: '2026-09-01T10:00:00Z' }),
    ).toThrow();
    expect(() =>
      parseGasFeeLogEntry({ txHash: 'a'.repeat(64), fee: 100, timestamp: 'not-a-date' }),
    ).toThrow();
  });
});

describe('aggregateGasFees', () => {
  it('sums fees exactly in stroops', () => {
    const aggregate = aggregateGasFees([
      entry('a'.repeat(64), 100n, '2026-09-01T10:00:00Z'),
      entry('b'.repeat(64), 100n, '2026-09-02T10:00:00Z'),
      entry('c'.repeat(64), 300n, '2026-09-02T12:00:00Z'),
    ]);
    expect(aggregate.totalStroops).toBe(500n);
    expect(aggregate.transactions).toBe(3);
    expect(aggregate.averageStroopsPerTx).toBe(166n); // 500 / 3 floored
  });

  it('computes the fee-to-volume ratio', () => {
    const aggregate = aggregateGasFees([entry('a'.repeat(64), 100n, '2026-09-01T10:00:00Z', '10')]);
    // 100 stroops of fee on 10 XLM (100_000_000 stroops) of volume.
    expect(aggregate.volumeStroops).toBe(100_000_000n);
    expect(aggregate.feeToVolumeRatio).toBeCloseTo(0.000001, 12);
  });

  it('returns a null ratio when no volume is known', () => {
    const aggregate = aggregateGasFees([
      {
        txHash: 'a'.repeat(64),
        ledger: null,
        feeStroops: 100n,
        timestamp: '2026-09-01T10:00:00Z',
        amount: null,
      },
    ]);
    expect(aggregate.feeToVolumeRatio).toBeNull();
  });

  it('fills gap days with zero-fee buckets', () => {
    const aggregate = aggregateGasFees([
      entry('a'.repeat(64), 100n, '2026-09-01T10:00:00Z'),
      entry('b'.repeat(64), 100n, '2026-09-03T10:00:00Z'),
    ]);
    expect(aggregate.buckets).toHaveLength(3);
    expect(aggregate.buckets[1].totalStroops).toBe(0n);
    expect(aggregate.buckets[1].transactions).toBe(0);
    expect(aggregate.buckets[0].fraction).toBe(1);
    expect(aggregate.buckets[1].fraction).toBe(0);
  });

  it('handles an empty log', () => {
    const aggregate = aggregateGasFees([]);
    expect(aggregate.totalStroops).toBe(0n);
    expect(aggregate.averageStroopsPerTx).toBeNull();
    expect(aggregate.buckets).toHaveLength(0);
  });
});

describe('stroopsToXlm', () => {
  it('formats stroops as an XLM decimal string', () => {
    expect(stroopsToXlm(100n)).toBe('0.0000100');
    expect(stroopsToXlm(1_234_567_890n)).toBe('123.4567890');
  });
});

describe('formatFeeToVolumeRatio', () => {
  it('formats tiny ratios without rounding them to zero', () => {
    expect(formatFeeToVolumeRatio(0.000001)).toBe('0.0001%');
    expect(formatFeeToVolumeRatio(0.029)).toBe('2.9000%');
    expect(formatFeeToVolumeRatio(0)).toBe('0%');
    expect(formatFeeToVolumeRatio(null)).toBe('—');
  });
});

describe('traditionalCardFeeForVolume', () => {
  it('charges 2.9% + 30¢ on the volume', () => {
    // 1,000 XLM = 10^10 stroops: 2.9% = 29 XLM, + 0.30 = 29.30 XLM.
    expect(traditionalCardFeeForVolume(10_000_000_000n)).toBe(293_000_000n);
  });
});

describe('gasLogToCsv', () => {
  it('writes a header row even for an empty log', () => {
    const csv = gasLogToCsv([]);
    expect(csv).toContain('Transaction Hash,Ledger,Timestamp,Fee (stroops),Fee (XLM),Amount');
  });

  it('serializes one row per entry with exact stroop values', () => {
    const csv = gasLogToCsv([entry('a'.repeat(64), 100n, '2026-09-01T10:00:00Z', '10')]);
    expect(csv).toContain(`${'a'.repeat(64)},42,2026-09-01T10:00:00Z,100,0.0000100,10`);
  });

  it('escapes fields that would break CSV', () => {
    const csv = gasLogToCsv([entry('hash,with,commas', 100n, '2026-09-01T10:00:00Z')]);
    expect(csv).toContain('"hash,with,commas"');
  });

  it('prepends the UTF-8 BOM for the export', () => {
    expect(gasCsvExport([]).charCodeAt(0)).toBe(0xfeff);
  });
});
