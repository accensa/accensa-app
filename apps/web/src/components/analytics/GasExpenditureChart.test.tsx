import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GasExpenditureChart } from './GasExpenditureChart';
import type { GasDayBucket } from '@/lib/analytics/gasCalculator';

const bucket = (
  day: string,
  totalStroops: bigint,
  transactions: number,
  fraction: number,
): GasDayBucket => ({
  day,
  label: day.slice(5, 10),
  totalStroops,
  transactions,
  fraction,
});

function render(buckets: GasDayBucket[] = []) {
  const html = renderToString(<GasExpenditureChart buckets={buckets} rangeLabel="3 days" />);
  return html.replace(/<!-- -->/g, '');
}

describe('GasExpenditureChart', () => {
  it('renders an empty state when there are no buckets', () => {
    expect(render()).toContain('No network fees recorded yet.');
  });

  it('renders one bar per day with accessible labels', () => {
    const html = render([
      bucket('2026-09-01T00:00:00.000Z', 100n, 1, 1),
      bucket('2026-09-02T00:00:00.000Z', 200n, 2, 1),
      bucket('2026-09-03T00:00:00.000Z', 0n, 0, 0),
    ]);
    expect(html).toContain('Network fees per day');
    expect(html).toContain('role="img"');
    // Three day groups, one per bucket.
    expect(html.match(/<g>/g)).toHaveLength(3);
  });

  it('offers a stroops/XLM unit toggle', () => {
    const html = render([bucket('2026-09-01T00:00:00.000Z', 100n, 1, 1)]);
    expect(html).toContain('aria-label="Fee unit"');
    expect(html).toContain('stroops');
    expect(html).toContain('XLM');
  });
});
