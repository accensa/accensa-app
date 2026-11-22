export class DecimalStringError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`Invalid decimal string: "${value}"`);
    this.name = 'DecimalStringError';
    this.value = value;
  }
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function sumDecimalStrings(values: string[]): string {
  const scale = values.reduce((max, value) => {
    if (!DECIMAL_PATTERN.test(value)) throw new DecimalStringError(value);
    return Math.max(max, value.split('.')[1]?.length ?? 0);
  }, 0);

  const factor = 10n ** BigInt(scale);
  const sum = values.reduce((total, value) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const magnitude = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, '0'));
    return total + (negative ? -magnitude : magnitude);
  }, 0n);

  const sign = sum < 0n ? '-' : '';
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
