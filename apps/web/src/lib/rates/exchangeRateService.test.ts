import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFiatAmount, getExchangeRates, resetExchangeRateCache } from './exchangeRateService';

const fiatRates = { EUR: 0.92, GBP: 0.79, NGN: 1500, BRL: 5.1, JPY: 150 };

afterEach(() => {
  resetExchangeRateCache();
  vi.restoreAllMocks();
});

describe('exchange rate service', () => {
  it('caches a live snapshot for 60 seconds', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            stellar: { usd: 0.12, eur: 0.11, gbp: 0.095, ngn: 180, brl: 0.61, jpy: 18 },
            'usd-coin': { usd: 1, eur: 0.92, gbp: 0.79, ngn: 1500, brl: 5.1, jpy: 150 },
          }),
          { status: 200 },
        ),
    );
    const now = Date.parse('2026-09-30T12:00:00.000Z');

    const first = await getExchangeRates({ fetchImpl: fetchImpl as typeof fetch, now });
    const second = await getExchangeRates({
      fetchImpl: fetchImpl as typeof fetch,
      now: now + 59_999,
    });

    expect(first.xlmUsd).toBe(0.12);
    expect(second.provider).toBe('CoinGecko');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback providers and serves stale cached rates when offline', async () => {
    const primary = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('coingecko')) {
        return new Response('unavailable', { status: 503 });
      }
      if (String(input).includes('stellar')) {
        return new Response(JSON.stringify({ data: { priceUsd: '0.12' } }), { status: 200 });
      }
      if (String(input).includes('usd-coin')) {
        return new Response(JSON.stringify({ data: { priceUsd: '1' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ rates: fiatRates }), { status: 200 });
    });
    const now = Date.parse('2026-09-30T12:00:00.000Z');

    const live = await getExchangeRates({ fetchImpl: primary as typeof fetch, now });
    const offline = await getExchangeRates({
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch,
      now: now + 60_001,
    });

    expect(live.provider).toBe('CoinCap + ExchangeRate-API');
    expect(live.fiatPerUsd.NGN).toBe(1500);
    expect(offline.stale).toBe(true);
    expect(offline.xlmUsd).toBe(0.12);
  });

  it('formats currency with locale-appropriate symbol placement and rounding', () => {
    expect(formatFiatAmount(10, 'USD')).toBe('$10.00');
    expect(formatFiatAmount(10, 'EUR')).toBe('10,00 €');
    expect(formatFiatAmount(10.6, 'JPY')).toBe('￥11');
  });
});
