import { describe, expect, it, vi } from 'vitest';
import type { Horizon } from '@stellar/stellar-sdk';
import {
  createHorizonFeeFetcher,
  horizonFeeFetcher,
  isTransactionHash,
  parseFeeStroops,
  resolveTransactionFees,
} from './transaction-fees';

const { serverConstructor, serverCalls } = vi.hoisted(() => ({
  serverConstructor: vi.fn(),
  serverCalls: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: class {
      constructor(url: string) {
        serverConstructor(url);
      }
      transactions() {
        return {
          transaction: (hash: string) => ({
            call: () => {
              serverCalls(hash);
              return Promise.resolve({ fee_charged: '5000' });
            },
          }),
        };
      }
    },
  },
}));

const hash = (n: number) => n.toString(16).padStart(64, '0');

describe('isTransactionHash', () => {
  it('accepts only 64-character hexadecimal hashes', () => {
    expect(isTransactionHash('AB'.repeat(32))).toBe(true);
    expect(isTransactionHash(hash(1))).toBe(true);
    expect(isTransactionHash('a'.repeat(63))).toBe(false);
    expect(isTransactionHash('z'.repeat(64))).toBe(false);
    expect(isTransactionHash(123)).toBe(false);
  });
});

describe('parseFeeStroops', () => {
  it('accepts non-negative integer stroops as numbers or strings', () => {
    expect(parseFeeStroops(100)).toBe('100');
    expect(parseFeeStroops(' 5000 ')).toBe('5000');
    expect(parseFeeStroops(0)).toBe('0');
  });

  it('rejects decimals, negatives and malformed values', () => {
    for (const value of ['100.5', '-1', 'abc', '', null, undefined, {}, NaN]) {
      expect(parseFeeStroops(value)).toBeNull();
    }
  });
});

describe('resolveTransactionFees', () => {
  it('resolves each distinct hash once and normalizes the lookup key', async () => {
    const fetchFee = vi.fn(async (txHash: string) => ({
      fee_charged: txHash === hash(1).toUpperCase() ? '100' : '5000',
    }));

    const result = await resolveTransactionFees(
      [hash(1).toUpperCase(), hash(1), hash(2)],
      fetchFee,
    );

    expect(fetchFee).toHaveBeenCalledTimes(2);
    expect(result.fees.get(hash(1))).toBe('100');
    expect(result.fees.get(hash(2))).toBe('5000');
    expect(result.unpriced).toEqual([]);
  });

  it('records invalid hashes as unpriced without looking them up', async () => {
    const fetchFee = vi.fn(async () => ({ fee_charged: '100' }));

    const result = await resolveTransactionFees(['not-a-hash', hash(1)], fetchFee);

    expect(fetchFee).toHaveBeenCalledTimes(1);
    expect(result.unpriced).toEqual(['not-a-hash']);
  });

  it('leaves the fee null when Horizon times out or the lookup fails', async () => {
    const timeout = vi.fn(() => new Promise<{ fee_charged: string }>(() => {}));
    const failure = vi.fn(async () => {
      throw new Error('Horizon 404');
    });

    const timedOut = await resolveTransactionFees([hash(1)], timeout, { timeoutMs: 10 });
    const failed = await resolveTransactionFees([hash(2)], failure);

    expect(timedOut.fees.size).toBe(0);
    expect(timedOut.unpriced).toEqual([hash(1)]);
    expect(failed.fees.size).toBe(0);
    expect(failed.unpriced).toEqual([hash(2)]);
  });

  it('treats a missing or malformed fee_charged as unpriced', async () => {
    const fetchFee = vi.fn(async (txHash: string) => ({
      fee_charged: txHash === hash(1) ? undefined : 'not-a-number',
    }));

    const result = await resolveTransactionFees([hash(1), hash(2)], fetchFee);

    expect(result.fees.size).toBe(0);
    expect(result.unpriced).toEqual([hash(1), hash(2)]);
  });

  it('caps concurrent Horizon lookups', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchFee = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { fee_charged: '100' };
    };

    const hashes = Array.from({ length: 12 }, (_, i) => hash(i));
    const result = await resolveTransactionFees(hashes, fetchFee, { concurrency: 3 });

    expect(maxActive).toBe(3);
    expect(result.fees.size).toBe(12);
    expect(result.unpriced).toEqual([]);
  });
});

describe('Horizon fetcher', () => {
  it('reads fee_charged through one Horizon server per fetcher', async () => {
    serverConstructor.mockClear();
    serverCalls.mockClear();
    const url = 'https://horizon.example';

    const fetcher = createHorizonFeeFetcher(url);
    expect(serverConstructor).toHaveBeenCalledTimes(1);
    expect(serverConstructor).toHaveBeenCalledWith(url);

    expect(await fetcher(hash(1))).toEqual({ fee_charged: '5000' });
    expect(serverCalls).toHaveBeenCalledTimes(1);
  });

  it('adapts an existing Horizon.Server to the fee fetcher interface', async () => {
    const transaction = vi.fn(() => ({ call: vi.fn().mockResolvedValue({ fee_charged: 100 }) }));
    const server = { transactions: () => ({ transaction }) } as unknown as Horizon.Server;

    const fetcher = horizonFeeFetcher(server);
    expect(await fetcher(hash(1))).toEqual({ fee_charged: 100 });
    expect(transaction).toHaveBeenCalledWith(hash(1));
  });
});
