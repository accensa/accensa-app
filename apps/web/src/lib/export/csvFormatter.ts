import { CsvPayment, CSV_BOM, toCsvRow } from '../payments-csv';
import { assetLabel } from '../money';

const HEADERS = [
  'Transaction Hash',
  'Timestamp',
  'Amount',
  'Asset',
  'Asset Identifier',
  'Payer',
  'Route',
  'Method',
  'Ledger',
  'Refunded',
];

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function formatCsvRow(payment: CsvPayment): string {
  return toCsvRow([
    neutralizeFormula(payment.tx_hash),
    payment.ts,
    payment.amount,
    assetLabel(payment.asset),
    neutralizeFormula(payment.asset ?? 'native'),
    neutralizeFormula(payment.payer),
    neutralizeFormula(payment.route ?? ''),
    neutralizeFormula(payment.method ?? ''),
    payment.ledger === null ? '' : String(payment.ledger),
    payment.refunded ? 'Yes' : '',
  ]);
}

/**
 * Creates a stream that yields CSV bytes without memory exhaustion.
 */
export function createCsvStream(
  paymentGenerator: AsyncGenerator<CsvPayment[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      // Send BOM and headers first
      controller.enqueue(encoder.encode(CSV_BOM));
      controller.enqueue(encoder.encode(toCsvRow(HEADERS) + '\r\n'));
    },
    async pull(controller) {
      try {
        const { value, done } = await paymentGenerator.next();
        if (done) {
          controller.close();
        } else {
          // Process chunks
          for (const payment of value) {
            controller.enqueue(encoder.encode(formatCsvRow(payment) + '\r\n'));
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      paymentGenerator.return?.(null);
    },
  });
}
