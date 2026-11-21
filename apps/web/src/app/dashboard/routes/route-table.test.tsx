import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { UNATTRIBUTED_LABEL, type RouteBreakdown, type RouteBucket } from '@/lib/revenue-analytics';
import { RouteTable } from './route-table';

function bucket(overrides: Partial<RouteBucket> & Pick<RouteBucket, 'key'>): RouteBucket {
  return {
    route: null,
    method: null,
    attributed: true,
    calls: 1,
    priced: 1,
    unpriced: 0,
    total: '10',
    average: '10',
    share: 1,
    ...overrides,
  };
}

function breakdown(routes: RouteBucket[], unattributed: RouteBucket | null): RouteBreakdown {
  return {
    asset: 'USDC',
    routes,
    unattributed,
    total: '0',
    attributedTotal: '0',
    unattributedTotal: '0',
    calls: 0,
    attributedCalls: 0,
    unattributedCalls: 0,
    unpricedCalls: 0,
  };
}

const rowsOf = (html: string) =>
  html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr\b/g) ?? [];

describe('RouteTable', () => {
  it('renders the empty message and no table when there is nothing to break down', () => {
    const html = renderToString(<RouteTable breakdown={breakdown([], null)} asset="USDC" />);

    expect(html).toContain('Nothing to break down yet.');
    expect(html).not.toContain('<table');
  });

  it('renders one captioned table with five headers and a row per bucket', () => {
    const routes = [
      bucket({
        key: 'GET /api/pay',
        method: 'GET',
        route: '/api/pay',
        total: '30',
        share: 0.75,
      }),
      bucket({
        key: 'POST /api/quote',
        method: 'POST',
        route: '/api/quote',
        total: '10',
        share: 0.25,
      }),
    ];
    const html = renderToString(<RouteTable breakdown={breakdown(routes, null)} asset="USDC" />);

    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html).toContain('Revenue by route breakdown');
    expect(html.match(/<th\b/g)).toHaveLength(5);
    expect(rowsOf(html)).toHaveLength(2);
    expect(html).toContain('/api/pay');
    expect(html).toContain('/api/quote');
    expect(html).not.toContain('Nothing to break down yet.');
  });

  it('shows the unattributed label, not a route, for an unattributed-only breakdown', () => {
    const unattributed = bucket({
      key: UNATTRIBUTED_LABEL,
      attributed: false,
      route: null,
      method: null,
    });
    const html = renderToString(
      <RouteTable breakdown={breakdown([], unattributed)} asset="USDC" />,
    );

    expect(rowsOf(html)).toHaveLength(1);
    expect(html).toContain(UNATTRIBUTED_LABEL);
    expect(html).not.toContain('/api/');
    expect(html).not.toContain('Nothing to break down yet.');
  });
});
