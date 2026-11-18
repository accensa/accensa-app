import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { isHash32 } from './receipt-anchor';
import { verifyReceipt } from '@accensa/sdk/merkle';
import fixture from '../../../../packages/sdk/merkle-vectors.json';

// The fixture is vendored byte-for-byte from accensa-contracts (see
// docs/CONFORMANCE.md there), which writes hashes 0x-prefixed; verifyReceipt
// takes bare hex.
const strip0x = (hash: string) => hash.replace(/^0x/i, '');
const vectors = fixture.vectors.map((v) => ({
  ...v,
  leaf: strip0x(v.leaf),
  proof: v.proof.map(strip0x),
  root: strip0x(v.root),
}));

// Testnet batch #1, anchored by accensa-contracts.
const ONCHAIN_ROOT = 'c6ccdcdb57896fa4999d9dea6a5ef40523d55e46cf32b621d7ea4a582d90e6ac';

const { simulateTransaction } = vi.hoisted(() => ({ simulateTransaction: vi.fn() }));

// Only the network call is replaced: transactions are still built by the real
// SDK, but simulateTransaction answers from the test instead of an RPC node.
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  class Server extends mod.rpc.Server {
    simulateTransaction = simulateTransaction;
  }
  return { ...mod, rpc: { ...mod.rpc, Server } };
});

/** A successful simulation whose return value is `value` as a u32. */
function simulated(value: number) {
  return { result: { retval: nativeToScVal(value, { type: 'u32' }) } };
}

describe('isHash32', () => {
  it('accepts a 64-character hex string', () => {
    expect(isHash32('a'.repeat(64))).toBe(true);
    expect(isHash32('A'.repeat(64))).toBe(true);
  });

  it('tolerates surrounding whitespace from pasted input', () => {
    expect(isHash32(` ${'a'.repeat(64)}\n`)).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isHash32('a'.repeat(63))).toBe(false);
    expect(isHash32('a'.repeat(65))).toBe(false);
    expect(isHash32('')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHash32('z'.repeat(64))).toBe(false);
    expect(isHash32(`0x${'a'.repeat(62)}`)).toBe(false);
  });
});

describe('verifier sample data', () => {
  // The /verify page ships a preloaded sample so anyone can see the verifier
  // work without first obtaining a receipt. If that sample drifts from the
  // conformance vectors, the front page of the product silently starts lying.
  const live = vectors[0];
  const forged = vectors[1];

  const SAMPLE_LEAF = 'c476fc0553303ec4275bd4cb50ab7fa8182e343dbc4c721d7e2076fd77a5b56c';
  const SAMPLE_PROOF = [
    '7ca64ee60e2b975f59f2a1f1cc1526d5b001a5c29f70291f316ba1c012a01bd1',
    '1733fad16ada0c23d8cdaff52bea66bea308dddddcb79348842acef0065c9615',
  ];
  const FORGED_LEAF = '16b138aabc889c21114436424e13132bd8928d2c21b4ac5a9ac5198104efb42c';

  it('valid sample matches the anchored conformance vector', () => {
    expect(SAMPLE_LEAF).toBe(live.leaf);
    expect(SAMPLE_PROOF).toEqual(live.proof);
    expect(live.expected).toBe(true);
  });

  it('forged sample matches the negative conformance vector', () => {
    expect(FORGED_LEAF).toBe(forged.leaf);
    expect(forged.expected).toBe(false);
  });

  it('valid sample verifies locally against the on-chain root', () => {
    expect(verifyReceipt(SAMPLE_LEAF, SAMPLE_PROOF, ONCHAIN_ROOT)).toBe(true);
  });

  it('forged sample fails locally against the on-chain root', () => {
    expect(verifyReceipt(FORGED_LEAF, SAMPLE_PROOF, ONCHAIN_ROOT)).toBe(false);
  });

  it('pins the batch that the sample refers to', () => {
    // Batch #1 on testnet, contract CBHRJU7CF4XIFRNDITFHNQHABKBMFM2FYFHLGWN3JGSFYYCDSMDAWPRV.
    expect(vectors[0].root).toBe(ONCHAIN_ROOT);
  });
});

describe('getMaxBatchSize', () => {
  // The cache is module state, so each test loads a fresh copy of the module.
  async function load() {
    vi.resetModules();
    return import('./receipt-anchor');
  }

  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the second call from the cache without simulating again', async () => {
    simulateTransaction.mockResolvedValue(simulated(500));
    const { getMaxBatchSize } = await load();

    expect(await getMaxBatchSize()).toBe(500);
    expect(await getMaxBatchSize()).toBe(500);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('shares one simulation between concurrent callers on a cold cache', async () => {
    simulateTransaction.mockResolvedValue(simulated(500));
    const { getMaxBatchSize } = await load();

    expect(await Promise.all([getMaxBatchSize(), getMaxBatchSize(), getMaxBatchSize()])).toEqual([
      500, 500, 500,
    ]);
    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('asks the contract again once the staleness bound has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    simulateTransaction.mockResolvedValueOnce(simulated(500)).mockResolvedValueOnce(simulated(750));
    const { getMaxBatchSize, MAX_BATCH_SIZE_TTL_MS } = await load();

    expect(await getMaxBatchSize()).toBe(500);
    vi.advanceTimersByTime(MAX_BATCH_SIZE_TTL_MS - 1);
    expect(await getMaxBatchSize()).toBe(500);
    vi.advanceTimersByTime(1);
    expect(await getMaxBatchSize()).toBe(750);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed read', async () => {
    simulateTransaction
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValueOnce(simulated(500));
    const { getMaxBatchSize } = await load();

    await expect(getMaxBatchSize()).rejects.toThrow('rpc down');
    expect(await getMaxBatchSize()).toBe(500);
    expect(simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it('rejects, without caching, a ceiling that is not a positive integer', async () => {
    simulateTransaction.mockResolvedValueOnce(simulated(0)).mockResolvedValueOnce(simulated(500));
    const { getMaxBatchSize } = await load();

    await expect(getMaxBatchSize()).rejects.toThrow('max_batch_size returned 0');
    expect(await getMaxBatchSize()).toBe(500);
  });
});
