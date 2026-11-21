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

import { ReceiptEmail } from './ReceiptEmail';

// Freeze props so the test is deterministic
const props = Object.freeze({
  txHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  merchantName: 'Acme Corp',
  amount: '12.50 USDC',
  date: '2026-11-21',
});

describe('ReceiptEmail', () => {
  it('renders without crashing', () => {
    const html = renderToStaticMarkup(<ReceiptEmail {...props} />);
    expect(html).toBeTruthy();
  });

  it('preview includes the amount', () => {
    const html = renderToStaticMarkup(<ReceiptEmail {...props} />);
    expect(html).toContain('12.50');
  });

  it('renders the exact "Amount: 12.50 USDC" line', () => {
    const html = renderToStaticMarkup(<ReceiptEmail {...props} />);
    expect(html).toContain('Amount: 12.50 USDC');
  });

  it('renders the transaction hash', () => {
    const html = renderToStaticMarkup(<ReceiptEmail {...props} />);
    expect(html).toContain(props.txHash);
  });
});
