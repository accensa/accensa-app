import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { getExchangeRates, type ExchangeRateSnapshot } from '@/lib/rates/exchangeRateService';

vi.mock('@/lib/rates/exchangeRateService', () => ({
  getExchangeRates: vi.fn(),
}));

const mockedGetExchangeRates = vi.mocked(getExchangeRates);

const snapshot: ExchangeRateSnapshot = {
  xlmUsd: 0.31,
  usdcUsd: 1,
  fiatPerUsd: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1500, BRL: 5.4, JPY: 151 },
  fetchedAt: '2026-11-19T00:00:00.000Z',
  provider: 'CoinCap + ExchangeRate-API',
  stale: false,
};

describe('GET /api/rates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('responds 200 with the rate snapshot as JSON', async () => {
    mockedGetExchangeRates.mockResolvedValue(snapshot);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mockedGetExchangeRates).toHaveBeenCalledTimes(1);
  });

  it('marks successful responses as uncacheable', async () => {
    mockedGetExchangeRates.mockResolvedValue(snapshot);

    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('responds 503 when the exchange rate service fails', async () => {
    mockedGetExchangeRates.mockRejectedValue(new Error('all providers down'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Exchange rates are temporarily unavailable',
    });
  });
});
