import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STELLAR_EXPERT_ORIGIN,
  explorerContractUrl,
  explorerTxUrl,
  resolveStellarNetwork,
} from './explorer';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveStellarNetwork', () => {
  it('accepts testnet and mainnet, plus the public/pubnet aliases', () => {
    expect(resolveStellarNetwork('testnet')).toBe('testnet');
    expect(resolveStellarNetwork(' TESTNET ')).toBe('testnet');
    expect(resolveStellarNetwork('mainnet')).toBe('mainnet');
    expect(resolveStellarNetwork('public')).toBe('mainnet');
    expect(resolveStellarNetwork('PubNet')).toBe('mainnet');
  });

  it('throws on an unrecognised value rather than guessing', () => {
    expect(() => resolveStellarNetwork('futurenet')).toThrow(/not a known Stellar network/);
  });

  it('falls back to testnet when unset, without throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveStellarNetwork(undefined)).toBe('testnet');
    expect(resolveStellarNetwork('')).toBe('testnet');
  });
});

describe('explorer URL builders', () => {
  it('builds testnet links', () => {
    expect(explorerTxUrl('TXHASH', 'testnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/tx/TXHASH`,
    );
    expect(explorerContractUrl('CID', 'testnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/testnet/contract/CID`,
    );
  });

  it('builds mainnet links against the explorer’s "public" path', () => {
    expect(explorerTxUrl('TXHASH', 'mainnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/tx/TXHASH`,
    );
    expect(explorerContractUrl('CID', 'mainnet')).toBe(
      `${STELLAR_EXPERT_ORIGIN}/explorer/public/contract/CID`,
    );
  });

  it('defaults the network from configuration when the argument is omitted', () => {
    // vitest.config.mjs sets NEXT_PUBLIC_STELLAR_NETWORK=testnet for the suite.
    expect(explorerTxUrl('TXHASH')).toBe(`${STELLAR_EXPERT_ORIGIN}/explorer/testnet/tx/TXHASH`);
  });
});
