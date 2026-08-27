import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentsTable, TableSkeleton } from './page';
import { RouteTable } from './routes/page';

describe('Dashboard tables accessibility', () => {
  it('renders PaymentsTable with accessible caption and column scopes on all headers', () => {
    const payments = [
      {
        tx_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        ledger: 12345,
        payer: 'GB...',
        amount: '1000',
        asset: 'USDC',
        ts: '2026-08-26T00:00:00.000Z',
        route: '/api/pay',
        method: 'POST',
      },
    ];

    const html = renderToString(
      <PaymentsTable payments={payments} refunded={new Set()} onSelect={() => {}} />,
    );

    // Accessible name
    expect(html).toContain('<caption class="sr-only">Recent Settlements</caption>');

    // Column scopes on every header
    expect(html).toContain('<th scope="col" class="px-8 py-5">Transaction</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Amount</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Payer</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Route</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Time</th>');

    const thMatches = html.match(/<th\b[^>]*>/g) ?? [];
    expect(thMatches.length).toBe(5);
    for (const th of thMatches) {
      expect(th).toContain('scope="col"');
    }
  });

  it('renders RouteTable with accessible caption, column scopes, and preserved sr-only share percentages', () => {
    const breakdown = {
      asset: 'USDC',
      total: '1000',
      calls: 2,
      unpricedCalls: 0,
      attributedTotal: '1000',
      attributedCalls: 2,
      unattributedTotal: '0',
      unattributedCalls: 0,
      routes: [
        {
          key: 'GET /api/pay',
          method: 'GET',
          route: '/api/pay',
          attributed: true,
          calls: 2,
          priced: 2,
          unpriced: 0,
          total: '1000',
          average: '500',
          share: 1,
        },
      ],
      unattributed: null,
    };

    const html = renderToString(<RouteTable breakdown={breakdown} asset="USDC" />);

    // Accessible name
    expect(html).toContain('<caption class="sr-only">Revenue by route breakdown</caption>');

    // Column scopes on every header
    expect(html).toContain('<th scope="col" class="pb-3 pr-4">Route</th>');
    expect(html).toContain('<th scope="col" class="pb-3 pr-4 text-right">Calls</th>');
    expect(html).toContain('<th scope="col" class="pb-3 pr-4 text-right">Revenue</th>');
    expect(html).toContain('<th scope="col" class="pb-3 pr-4 text-right">Average</th>');
    expect(html).toContain('<th scope="col" class="pb-3 w-1/4">Share</th>');

    // Ensure all <th> have scope="col"
    const thMatches = html.match(/<th\b[^>]*>/g) ?? [];
    expect(thMatches.length).toBe(5);
    for (const th of thMatches) {
      expect(th).toContain('scope="col"');
    }

    // Preserves sr-only share percentage and aria-hidden visual bar
    expect(html).toContain('<span class="sr-only">100%</span>');
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders TableSkeleton with matching mobile and desktop responsive layouts with aria-hidden', () => {
    const html = renderToString(<TableSkeleton />);

    // Mobile layout skeleton
    expect(html).toContain('class="md:hidden divide-y');
    // Desktop layout table skeleton
    expect(html).toContain('class="hidden md:block');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Transaction</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Amount</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Payer</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Route</th>');
    expect(html).toContain('<th scope="col" class="px-8 py-5">Time</th>');
    expect(html).toContain('aria-hidden="true"');
  });
});
