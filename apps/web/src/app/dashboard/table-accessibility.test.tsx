import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentsCardList, PaymentsTable, TableSkeleton } from './page';
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

  it('renders every PaymentsTable row with role="button" and tabIndex for keyboard access', () => {
    const payments = [
      {
        tx_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        ledger: 1,
        payer: 'GA...',
        amount: '500',
        asset: 'USDC',
        ts: '2026-08-26T00:00:00.000Z',
        route: null,
        method: null,
      },
      {
        tx_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ledger: 2,
        payer: 'GB...',
        amount: '200',
        asset: 'XLM',
        ts: '2026-08-25T00:00:00.000Z',
        route: '/api/sell',
        method: 'POST',
      },
    ];

    const html = renderToString(
      <PaymentsTable payments={payments} refunded={new Set()} onSelect={() => {}} />,
    );

    // Every <tr> in <tbody> must be a button for keyboard access
    const trMatches = html.match(/<tr\b[^>]*role="button"[^>]*>/g) ?? [];
    expect(trMatches.length).toBe(2);
    for (const tr of trMatches) {
      expect(tr).toContain('tabindex="0"');
      expect(tr).toContain('aria-label="');
      expect(tr).toContain('view details');
      expect(tr).toContain('focus-visible:outline-2');
    }
  });

  it('PaymentsTable aria-labels are unique per payment', () => {
    const payments = [
      {
        tx_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        ledger: 1,
        payer: 'GA...',
        amount: '500',
        asset: 'USDC',
        ts: '2026-08-26T00:00:00.000Z',
        route: null,
        method: null,
      },
      {
        tx_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ledger: 2,
        payer: 'GB...',
        amount: '200',
        asset: 'XLM',
        ts: '2026-08-25T00:00:00.000Z',
        route: null,
        method: null,
      },
    ];

    const html = renderToString(
      <PaymentsTable payments={payments} refunded={new Set()} onSelect={() => {}} />,
    );

    const ariaLabels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(ariaLabels.length).toBe(2);
    // Both should reference 'Payment' and 'view details' but differ in the amount/hash
    for (const label of ariaLabels) {
      expect(label).toMatch(/^Payment \d/);
      expect(label).toContain('view details');
    }
    expect(ariaLabels[0]).not.toBe(ariaLabels[1]);
  });

  it('renders every PaymentsCardList card with role="button" and tabIndex for keyboard access', () => {
    const payments = [
      {
        tx_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        ledger: 1,
        payer: 'GA...',
        amount: '500',
        asset: 'USDC',
        ts: '2026-08-26T00:00:00.000Z',
        route: null,
        method: null,
      },
      {
        tx_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ledger: 2,
        payer: 'GB...',
        amount: '200',
        asset: 'XLM',
        ts: '2026-08-25T00:00:00.000Z',
        route: '/api/sell',
        method: 'POST',
      },
    ];

    const html = renderToString(<PaymentsCardList payments={payments} onSelect={() => {}} />);

    // Every <div> card must be a button for keyboard access
    const divMatches = html.match(/<div\b[^>]*role="button"[^>]*>/g) ?? [];
    expect(divMatches.length).toBe(2);
    for (const div of divMatches) {
      expect(div).toContain('tabindex="0"');
      expect(div).toContain('aria-label="');
      expect(div).toContain('view details');
      expect(div).toContain('focus-visible:outline-2');
    }
  });

  it('PaymentsCardList aria-labels are unique per payment', () => {
    const payments = [
      {
        tx_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        ledger: 1,
        payer: 'GA...',
        amount: '500',
        asset: 'USDC',
        ts: '2026-08-26T00:00:00.000Z',
        route: null,
        method: null,
      },
      {
        tx_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        ledger: 2,
        payer: 'GB...',
        amount: '200',
        asset: 'XLM',
        ts: '2026-08-25T00:00:00.000Z',
        route: null,
        method: null,
      },
    ];

    const html = renderToString(<PaymentsCardList payments={payments} onSelect={() => {}} />);

    const ariaLabels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(ariaLabels.length).toBe(2);
    for (const label of ariaLabels) {
      expect(label).toMatch(/^Payment \d/);
      expect(label).toContain('view details');
    }
    expect(ariaLabels[0]).not.toBe(ariaLabels[1]);
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
