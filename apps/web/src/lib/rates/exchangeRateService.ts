export const FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'BRL', 'JPY'] as const;
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number];

export interface ExchangeRateSnapshot {
  xlmUsd: number;
  usdcUsd: number;
  fiatPerUsd: Record<FiatCurrency, number>;
  fetchedAt: string;
  provider: string;
  stale?: boolean;
}

const CACHE_TTL_MS = 60_000;
let cachedSnapshot: ExchangeRateSnapshot | null = null;

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFiatRates(value: unknown): Record<FiatCurrency, number> | null {
  if (!value || typeof value !== 'object') return null;
  const rates = value as Record<string, unknown>;
  const parsed = Object.fromEntries(
    FIAT_CURRENCIES.map((currency) => [
      currency,
      currency === 'USD' ? 1 : positiveNumber(rates[currency]),
    ]),
  ) as Record<FiatCurrency, number | null>;
  if (FIAT_CURRENCIES.some((currency) => parsed[currency] === null)) return null;
  return parsed as Record<FiatCurrency, number>;
}

async function getJson(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Rate provider returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function fetchCoinGecko(
  fetchImpl: typeof fetch,
): Promise<Omit<ExchangeRateSnapshot, 'fetchedAt'>> {
  const query = FIAT_CURRENCIES.map((currency) => currency.toLowerCase()).join(',');
  const data = (await getJson(
    fetchImpl,
    `https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin&vs_currencies=${query}`,
  )) as Record<string, Record<string, unknown>>;
  const xlm = data.stellar;
  const usdc = data['usd-coin'];
  const xlmUsd = positiveNumber(xlm?.usd);
  const usdcUsd = positiveNumber(usdc?.usd);
  if (!xlmUsd || !usdcUsd) throw new Error('CoinGecko response is missing USD rates');
  const fiatPerUsd = Object.fromEntries(
    FIAT_CURRENCIES.map((currency) => [
      currency,
      currency === 'USD' ? 1 : positiveNumber(xlm?.[currency.toLowerCase()])! / xlmUsd,
    ]),
  ) as Record<FiatCurrency, number>;
  if (FIAT_CURRENCIES.some((currency) => !positiveNumber(fiatPerUsd[currency]))) {
    throw new Error('CoinGecko response is missing fiat rates');
  }
  return { xlmUsd, usdcUsd, fiatPerUsd, provider: 'CoinGecko' };
}

async function fetchFallback(
  fetchImpl: typeof fetch,
): Promise<Omit<ExchangeRateSnapshot, 'fetchedAt'>> {
  const [xlmData, usdcData, fxData] = await Promise.all([
    getJson(fetchImpl, 'https://api.coincap.io/v2/assets/stellar'),
    getJson(fetchImpl, 'https://api.coincap.io/v2/assets/usd-coin'),
    getJson(fetchImpl, 'https://open.er-api.com/v6/latest/USD'),
  ]);
  const xlmUsd = positiveNumber((xlmData as { data?: { priceUsd?: unknown } }).data?.priceUsd);
  const usdcUsd = positiveNumber((usdcData as { data?: { priceUsd?: unknown } }).data?.priceUsd);
  const fx = fxData as { rates?: unknown };
  const fiatPerUsd = parseFiatRates(fx.rates);
  if (!xlmUsd || !usdcUsd || !fiatPerUsd)
    throw new Error('Fallback rate provider response is incomplete');
  return { xlmUsd, usdcUsd, fiatPerUsd, provider: 'CoinCap + ExchangeRate-API' };
}

export async function getExchangeRates(
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<ExchangeRateSnapshot> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now();
  if (cachedSnapshot && now - Date.parse(cachedSnapshot.fetchedAt) < CACHE_TTL_MS) {
    return { ...cachedSnapshot, stale: false };
  }

  for (const provider of [fetchCoinGecko, fetchFallback]) {
    try {
      const rates = await provider(fetchImpl);
      cachedSnapshot = { ...rates, fetchedAt: new Date(now).toISOString() };
      return { ...cachedSnapshot, stale: false };
    } catch {
      // Try the next provider; a stale snapshot is returned only if all fail.
    }
  }

  if (cachedSnapshot) return { ...cachedSnapshot, stale: true };
  throw new Error('Exchange rate providers are unavailable and no cached snapshot exists');
}

export function formatFiatAmount(amount: number, currency: FiatCurrency): string {
  const locale: Record<FiatCurrency, string> = {
    USD: 'en-US',
    EUR: 'de-DE',
    GBP: 'en-GB',
    NGN: 'en-NG',
    BRL: 'pt-BR',
    JPY: 'ja-JP',
  };
  return new Intl.NumberFormat(locale[currency], {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount);
}

export function resetExchangeRateCache() {
  cachedSnapshot = null;
}
