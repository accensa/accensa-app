export function sumDecimalStrings(values: string[]): string {
  const scale = Math.max(0, ...values.map((value) => value.split('.')[1]?.length ?? 0));
  const factor = 10n ** BigInt(scale);
  const sum = values.reduce((total, value) => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
    const magnitude = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, '0') || '0');
    return total + (negative ? -magnitude : magnitude);
  }, 0n);
  const sign = sum < 0n ? '-' : '';
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${digits}`;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
