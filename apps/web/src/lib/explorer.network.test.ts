import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ResolveFn = typeof import('./explorer').resolveStellarNetwork;

let resolveStellarNetwork: ResolveFn;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // The "warned once" flag is module state; a fresh import starts it false.
  vi.resetModules();
  ({ resolveStellarNetwork } = await import('./explorer'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveStellarNetwork aliases', () => {
  it.each([
    ['testnet', 'testnet'],
    ['  TestNet ', 'testnet'],
    ['mainnet', 'mainnet'],
    [' MAINNET\t', 'mainnet'],
    ['public', 'mainnet'],
    ['  Public  ', 'mainnet'],
    ['pubnet', 'mainnet'],
    ['\nPubNet ', 'mainnet'],
  ])('maps %j to %s without warning', (raw, expected) => {
    expect(resolveStellarNetwork(raw)).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('resolveStellarNetwork when unset', () => {
  it('falls back to testnet and warns exactly once across repeated calls', () => {
    expect(resolveStellarNetwork(undefined)).toBe('testnet');
    expect(resolveStellarNetwork(undefined)).toBe('testnet');
    expect(resolveStellarNetwork('')).toBe('testnet');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
  });

  it('treats whitespace-only input as unset', () => {
    expect(resolveStellarNetwork('   ')).toBe('testnet');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveStellarNetwork with an unknown value', () => {
  it('throws naming the variable and the offending value, without warning', () => {
    let message = '';
    try {
      resolveStellarNetwork('futurenet');
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
    expect(message).toContain('futurenet');
    expect(warn).not.toHaveBeenCalled();
  });
});
