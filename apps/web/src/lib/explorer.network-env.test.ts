import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('explorer network environment memoisation (#757)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    }
    vi.restoreAllMocks();
  });

  it('memoises deployment network on first use: reassigning process.env does not alter subsequent calls in the same module instance', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const { explorerTxUrl, explorerContractUrl } = await import('./explorer');

    // First call resolves and caches 'mainnet' -> segment 'public'
    const firstUrl = explorerTxUrl('TX1');
    expect(firstUrl).toBe('https://stellar.expert/explorer/public/tx/TX1');

    // Reassigning env variable within the same module instance
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';

    // Second call without argument in the same module instance must still return mainnet
    const secondUrl = explorerTxUrl('TX1');
    expect(secondUrl).toBe('https://stellar.expert/explorer/public/tx/TX1');
    expect(firstUrl).toBe(secondUrl);

    const contractLink = explorerContractUrl('CID1');
    expect(contractLink).toBe('https://stellar.expert/explorer/public/contract/CID1');
  });

  it('vi.resetModules() followed by dynamic import re-evaluates the environment variable on the new module instance', async () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const mod1 = await import('./explorer');
    expect(mod1.explorerTxUrl('TX_MAIN')).toBe('https://stellar.expert/explorer/public/tx/TX_MAIN');

    // Reset module registry and switch to testnet
    vi.resetModules();
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';

    const mod2 = await import('./explorer');
    expect(mod2.explorerTxUrl('TX_TEST')).toBe(
      'https://stellar.expert/explorer/testnet/tx/TX_TEST',
    );
  });

  it('resolveStellarNetwork accepts explicit parameter and validates correctly', async () => {
    const { resolveStellarNetwork } = await import('./explorer');
    expect(resolveStellarNetwork('testnet')).toBe('testnet');
    expect(resolveStellarNetwork('mainnet')).toBe('mainnet');
    expect(resolveStellarNetwork(undefined)).toBe('testnet');
    expect(() => resolveStellarNetwork('futurenet')).toThrow(/not a known Stellar network/);
  });

  it('emits exactly one console.warn across multiple no-argument link calls when variable is unset', async () => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { explorerTxUrl, explorerContractUrl } = await import('./explorer');

    explorerTxUrl('TX1');
    explorerTxUrl('TX2');
    explorerContractUrl('CID1');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'NEXT_PUBLIC_STELLAR_NETWORK is not set; explorer links will point at testnet',
      ),
    );
  });
});
