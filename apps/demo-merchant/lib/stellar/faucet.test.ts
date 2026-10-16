import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fundTestnetAccount } from './faucet';

describe('fundTestnetAccount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves on success and queries the friendbot URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fundTestnetAccount('GTEST123')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://friendbot.stellar.org?addr=GTEST123');
  });

  it('throws on rate limit (429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      }),
    );

    await expect(fundTestnetAccount('GTEST123')).rejects.toThrow(
      'Rate limited by Friendbot. Please try again later.',
    );
  });

  it('throws on generic failure with detail message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Friendbot service unavailable' }),
      }),
    );

    await expect(fundTestnetAccount('GTEST123')).rejects.toThrow('Friendbot service unavailable');
  });

  it('falls back to default message when error body has no detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }),
    );

    await expect(fundTestnetAccount('GTEST123')).rejects.toThrow('Failed to fund account.');
  });
});
