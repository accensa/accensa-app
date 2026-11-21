import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

// @react-email/components is a runtime/build dep not installed in the test
// environment. Stub it with plain HTML so renderToStaticMarkup produces
// inspectable output without requiring the full package.
vi.mock('@react-email/components', () => ({
  Html: ({ children }: { children: React.ReactNode }) =>
    React.createElement('html', null, children),
  Head: () => React.createElement('head', null),
  Preview: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'preview' }, children),
  Body: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('body', { style }, children),
  Container: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Section: ({ children }: { children: React.ReactNode }) =>
    React.createElement('section', null, children),
  Text: ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) =>
    React.createElement('p', { style }, children),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

import { ReceiptEmail, ReceiptEmailProps } from './ReceiptEmail';

const BASE_PROPS: ReceiptEmailProps = {
  txHash: 'abc123',
  merchantName: 'Test Merchant',
  amount: '10.00 USDC',
  date: '2026-03-04T23:20:00.000Z',
};

describe('ReceiptEmail date prop', () => {
  it('renders an ISO string date as a human-readable timestamp ending with UTC', () => {
    const html = renderToStaticMarkup(
      <ReceiptEmail {...BASE_PROPS} date="2026-03-04T23:20:00.000Z" />,
    );
    expect(html).toMatch(/4 Mar 2026/i);
    expect(html).toContain('UTC');
  });

  it('renders a Date object in the same format as an ISO string for the same instant', () => {
    const iso = '2026-03-04T23:20:00.000Z';
    const isoHtml = renderToStaticMarkup(<ReceiptEmail {...BASE_PROPS} date={iso} />);
    const dateHtml = renderToStaticMarkup(<ReceiptEmail {...BASE_PROPS} date={new Date(iso)} />);
    expect(dateHtml).toBe(isoHtml);
  });

  it('renders an epoch-milliseconds number in the same format as an ISO string', () => {
    const iso = '2026-03-04T23:20:00.000Z';
    const epoch = new Date(iso).getTime();
    const isoHtml = renderToStaticMarkup(<ReceiptEmail {...BASE_PROPS} date={iso} />);
    const epochHtml = renderToStaticMarkup(<ReceiptEmail {...BASE_PROPS} date={epoch} />);
    expect(epochHtml).toBe(isoHtml);
  });

  it('renders an em dash for an invalid date value', () => {
    const html = renderToStaticMarkup(<ReceiptEmail {...BASE_PROPS} date="not-a-date" />);
    expect(html).toContain('—');
  });

  it('a non-UTC TZ env var does not change the UTC output', () => {
    const saved = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const html = renderToStaticMarkup(
        <ReceiptEmail {...BASE_PROPS} date="2026-03-04T23:20:00.000Z" />,
      );
      expect(html).toContain('UTC');
    } finally {
      if (saved === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = saved;
      }
    }
  });
});
