/**
 * Multi-currency price formatting helpers (#144).
 *
 * Provides locale-aware formatting for Stellar asset amounts with proper
 * decimal handling, thousands separators, and currency symbol display.
 *
 * Usage:
 *   import { formatPrice, formatPriceWithSymbol, parseAssetCode } from '@accensa/sdk/currency';
 *
 *   formatPrice('1234567.8912345', 7);           // "1,234,567.8912345"
 *   formatPriceWithSymbol('0.5', 7, 'USDC');     // "0.5000000 USDC"
 *   parseAssetCode('EURC-GDXE...');               // "EURC"
 */

/** Default decimal precision for Stellar native asset (XLM). */
export const XLM_DECIMALS = 7;

/**
 * Format a decimal string amount with the given number of decimal places.
 *
 * Uses the browser/Node Intl.NumberFormat for locale-aware thousands
 * separators. Falls back to basic comma formatting when Intl is unavailable.
 *
 * @param amount   Decimal string (e.g. "1234567.89")
 * @param decimals Number of decimal places the asset uses (default 7)
 * @param locale   BCP-47 locale string (default "en-US")
 */
export function formatPrice(
  amount: string,
  decimals: number = XLM_DECIMALS,
  locale: string = 'en-US',
): string {
  const num = parseFloat(amount);
  if (Number.isNaN(num)) return amount;

  // Intl is available in modern browsers and Node 12+
  if (typeof Intl !== 'undefined' && typeof Intl.NumberFormat === 'function') {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(num);
  }

  // Fallback: basic comma-separated formatting
  const parts = num.toFixed(decimals).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/**
 * Format a price with a currency/asset symbol.
 *
 * @param amount   Decimal string
 * @param decimals Asset decimal places
 * @param symbol   Asset code or currency symbol (e.g. "USDC", "EURC", "XLM")
 * @param locale   BCP-47 locale string
 */
export function formatPriceWithSymbol(
  amount: string,
  decimals: number = XLM_DECIMALS,
  symbol: string = 'XLM',
  locale: string = 'en-US',
): string {
  const formatted = formatPrice(amount, decimals, locale);
  return `${formatted} ${symbol}`;
}

/**
 * Parse the asset code from a Stellar asset identifier.
 *
 * Accepts:
 *   - "XLM" (native)
 *   - "USDC-GDXY..." (alphanumeric with issuer)
 *   - "GDXY..." (pure issuer, returns first 4 chars)
 *
 * @param asset Asset string from the indexer
 */
export function parseAssetCode(asset: string | null | undefined): string {
  if (!asset || asset === 'native') return 'XLM';
  const dashIdx = asset.indexOf('-');
  if (dashIdx > 0) return asset.substring(0, dashIdx);
  // Pure issuer key — use first 4 chars as short code
  if (asset.length > 4) return asset.substring(0, 4);
  return asset;
}

/**
 * Format an amount with its detected asset code.
 *
 * Convenience wrapper that parses the asset code and formats with symbol.
 *
 * @param amount  Decimal string
 * @param asset   Asset identifier (e.g. "USDC-GDXY..." or "native")
 * @param locale  BCP-47 locale string
 */
export function formatAssetAmount(
  amount: string,
  asset: string | null | undefined,
  locale: string = 'en-US',
): string {
  const code = parseAssetCode(asset);
  const decimals = asset === 'native' || !asset ? XLM_DECIMALS : 7;
  return formatPriceWithSymbol(amount, decimals, code, locale);
}
