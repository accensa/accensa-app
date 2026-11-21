import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCsvStream, formatCsvRow } from './csvFormatter';
import { CSV_BOM, type CsvPayment } from '../payments-csv';

const HEADER_ROW =
  'Transaction Hash,Timestamp,Amount,Asset,Asset Identifier,Payer,Route,Method,Ledger,Refunded\r\n';

function payment(overrides: Partial<CsvPayment> = {}): CsvPayment {
  return {
    tx_hash: 'hash-1',
    ledger: 42,
    payer: 'GAPAYER',
    amount: '1.0000000',
    asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    ts: '2026-10-18T00:00:00.000Z',
    route: '/checkout',
    method: 'POST',
    refunded: false,
    ...overrides,
  };
}

async function* chunksOf(...chunks: CsvPayment[][]): AsyncGenerator<CsvPayment[]> {
  yield* chunks;
}

/** Drains a stream and decodes everything it emitted. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  // Keep the BOM intact: the default decoder silently strips a leading U+FEFF.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let output = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatCsvRow', () => {
  it('writes a plain payment row', () => {
    expect(formatCsvRow(payment())).toBe(
      [
        'hash-1',
        '2026-10-18T00:00:00.000Z',
        '1.0000000',
        'USDC',
        'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        'GAPAYER',
        '/checkout',
        'POST',
        '42',
        '',
      ].join(','),
    );
  });

  it('leaves empty optional columns empty and marks refunds', () => {
    expect(formatCsvRow(payment({ ledger: null, route: null, method: null, refunded: true }))).toBe(
      [
        'hash-1',
        '2026-10-18T00:00:00.000Z',
        '1.0000000',
        'USDC',
        'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        'GAPAYER',
        '',
        '',
        '',
        'Yes',
      ].join(','),
    );
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tindented', '\rcarriage'])(
    'neutralizes the formula prefix in %j',
    (value) => {
      // The cell is prefixed with an apostrophe; RFC 4180 quoting may wrap it.
      expect(formatCsvRow(payment({ tx_hash: value }))).toContain(`'${value}`);
    },
  );

  it('does not neutralize ordinary free-text values', () => {
    const row = formatCsvRow(payment({ tx_hash: 'plain-hash', route: '(checkout)' }));

    expect(row).toContain('plain-hash');
    expect(row).toContain('(checkout)');
  });
});

describe('createCsvStream', () => {
  it('emits the UTF-8 BOM followed by the header row for an empty export', async () => {
    const output = await readAll(createCsvStream(chunksOf()));

    expect(output).toBe(CSV_BOM + HEADER_ROW);
  });

  it('streams every row and calls onClose once when the generator is exhausted', async () => {
    const onClose = vi.fn();
    const output = await readAll(
      createCsvStream(chunksOf([payment()], [payment({ tx_hash: 'hash-2' })]), { onClose }),
    );

    expect(output).toBe(
      CSV_BOM +
        HEADER_ROW +
        formatCsvRow(payment()) +
        '\r\n' +
        formatCsvRow(payment({ tx_hash: 'hash-2' })) +
        '\r\n',
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stops at the row cap, writes the marker, and returns the generator', async () => {
    let returned = false;
    async function* capped(): AsyncGenerator<CsvPayment[]> {
      try {
        yield [payment({ tx_hash: 'hash-a' }), payment({ tx_hash: 'hash-b' })];
        yield [payment({ tx_hash: 'hash-c' })];
      } finally {
        returned = true;
      }
    }
    const onClose = vi.fn();

    const output = await readAll(createCsvStream(capped(), { rowCap: 2, onClose }));

    expect(output).toContain('# EXPORT ROW CAP REACHED,2\r\n');
    expect(output).toContain('hash-a');
    expect(output).toContain('hash-b');
    expect(output).not.toContain('hash-c');
    expect(output.endsWith('# EXPORT ROW CAP REACHED,2\r\n')).toBe(true);
    expect(returned).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not write the cap marker when the rows stay under the cap', async () => {
    const output = await readAll(
      createCsvStream(chunksOf([payment({ tx_hash: 'hash-a' })]), { rowCap: 5 }),
    );

    expect(output).not.toContain('# EXPORT ROW CAP REACHED');
  });

  it('writes an error row and closes when the generator throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();
    async function* failing(): AsyncGenerator<CsvPayment[]> {
      yield [payment({ tx_hash: 'hash-a' })];
      throw new Error('indexer unavailable');
    }

    const output = await readAll(createCsvStream(failing(), { onClose }));

    expect(output).toContain('hash-a');
    expect(output.endsWith('# EXPORT ERROR,The export could not be completed\r\n')).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose and returns the generator when the consumer cancels', async () => {
    let returned = false;
    async function* endless(): AsyncGenerator<CsvPayment[]> {
      try {
        for (let index = 0; index < 100; index += 1) {
          yield [payment({ tx_hash: `hash-${index}` })];
        }
      } finally {
        returned = true;
      }
    }
    const onClose = vi.fn();
    const reader = createCsvStream(endless(), { onClose }).getReader();

    await reader.read(); // BOM
    await reader.read(); // header row
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('hash-0');
    await reader.cancel();

    expect(onClose).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(returned).toBe(true));
  });
});
