/**
 * Multi-currency price formatting utilities for the Accensa SDK.
 *
 * Converts raw stroop amounts to human-readable formatted strings based on
 * token type. All arithmetic is integer-only to avoid floating-point drift.
 */

/** Number of decimal places in Stellar stroops. */
const SCALE = 7;
const SCALE_FACTOR = 10_000_000n;

/** Well-known token metadata. */
export interface TokenMeta {
  /** SEP-11 asset identifier, e.g."native"or"USDC:GA..." */
  asset: string;
  /** Human-readable symbol, e.g."XLM"or"USDC". */
  symbol: string;
  /** Number of decimal places for display (defaults to 7 for Stellar). */
  decimals?: number;
}

/** Built-in token definitions for common Stellar assets. */
export const TOKENS: Record<string, TokenMeta> = {
  native: { asset: 'native', symbol: 'XLM', decimals: 7 },
  USDC: {
    asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    symbol: 'USDC',
    decimals: 7,
  },
};

/**
 * Parses a decimal string into integer stroops. Returns null if unparseable.
 *
 * Matches the behaviour of the web app's `toStroops` but is kept self-contained
 * so the SDK does not depend on the web package.
 */
export function toStroops(amount: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(amount.trim());
  if (!match) return null;
  const [, sign, whole, frac = ''] = match;
  const padded = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const value = BigInt(whole) * SCALE_FACTOR + BigInt(padded || '0');
  return sign === '-' ? -value : value;
}

/** Formats integer stroops as a decimal string with 7 places. */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${abs / SCALE_FACTOR}.${frac}`;
}

/**
 * Formats a stroop amount as a human-readable price with the token symbol.
 *
 * ```ts
 * formatPrice('12500000', 'native')       // "1.25 XLM"
 * formatPrice('10000000', 'USDC')         // "1.00 USDC"
 * formatPrice('0.0000001', 'native')      // "0.0000001 XLM"
 * ```
 */
export function formatPrice(stroopsOrDecimal: string, asset: string = 'native'): string {
  const meta = resolveToken(asset);
  const stroops = toStroops(stroopsOrDecimal);
  if (stroops === null) return stroopsOrDecimal;

  const fixed = fromStroops(stroops);
  const negative = fixed.startsWith('-');
  const [whole, frac = ''] = (negative ? fixed.slice(1) : fixed).split('.');

  const decimals = meta.decimals ?? SCALE;
  let trimmed = frac.replace(/0+$/, '');
  if (trimmed.length < Math.min(2, decimals)) {
    trimmed = trimmed.padEnd(Math.min(2, decimals), '0');
  }
  if (trimmed.length > decimals) trimmed = trimmed.slice(0, decimals);

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const formatted = `${negative ? '-' : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`;
  return `${formatted} ${meta.symbol}`;
}

/**
 * Formats a stroop amount as a compact price without the token symbol.
 *
 * Useful in tight UI spaces where the symbol is shown separately.
 *
 * ```ts
 * formatPriceCompact('12500000')  // "1.25"
 * ```
 */
export function formatPriceCompact(stroopsOrDecimal: string): string {
  const stroops = toStroops(stroopsOrDecimal);
  if (stroops === null) return stroopsOrDecimal;

  const fixed = fromStroops(stroops);
  const negative = fixed.startsWith('-');
  const [whole, frac = ''] = (negative ? fixed.slice(1) : fixed).split('.');

  let trimmed = frac.replace(/0+$/, '');
  if (trimmed.length < 2) trimmed = trimmed.padEnd(2, '0');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/**
 * Returns the human-readable symbol for a SEP-11 asset identifier.
 *
 * ```ts
 * assetSymbol('native')            // "XLM"
 * assetSymbol('USDC:GA...')        // "USDC"
 * assetSymbol(null)                // "XLM"
 * ```
 */
export function assetSymbol(asset: string | null): string {
  if (!asset || asset === 'native') return 'XLM';
  return asset.split(':')[0];
}

function resolveToken(asset: string): TokenMeta {
  if (!asset || asset === 'native') return TOKENS.native;
  const code = asset.split(':')[0];
  return TOKENS[code] ?? { asset, symbol: code, decimals: SCALE };
}
