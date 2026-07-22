/**
 * Decimal helpers for Stellar amounts.
 *
 * Amounts arrive from the API as decimal strings with 7 places, because that is
 * how they exist on the ledger. Everything here works in integer stroops via
 * bigint: no value passes through a float, so nothing is ever rounded away.
 */

const SCALE = 7;
const SCALE_FACTOR = 10_000_000n;

/** Parses a decimal string into integer stroops. Returns null if unparseable. */
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

/** Sums decimal amount strings exactly. Unparseable entries are skipped. */
export function sumAmounts(amounts: string[]): string {
  let total = 0n;
  for (const amount of amounts) {
    const stroops = toStroops(amount);
    if (stroops !== null) total += stroops;
  }
  return fromStroops(total);
}

/**
 * Formats an amount for display: thousands separators, at least `minDecimals`
 * places, trailing zeros beyond that trimmed.
 *
 * Grouping is applied to the integer part as a string, so large amounts are not
 * pushed through Number and corrupted.
 */
export function formatAmount(amount: string, minDecimals = 2): string {
  const stroops = toStroops(amount);
  if (stroops === null) return amount;

  const fixed = fromStroops(stroops);
  const negative = fixed.startsWith('-');
  const [whole, frac = ''] = (negative ? fixed.slice(1) : fixed).split('.');

  let trimmed = frac.replace(/0+$/, '');
  if (trimmed.length < minDecimals) trimmed = trimmed.padEnd(minDecimals, '0');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/** Human label for a SEP-11 asset identifier. */
export function assetLabel(asset: string | null): string {
  if (!asset || asset === 'native') return 'XLM';
  return asset.split(':')[0];
}
