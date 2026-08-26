import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentModal } from './page';

describe('Dashboard modal copy affordances', () => {
  it('renders copy controls for full transaction hash and payer address in payment modal', () => {
    const payment = {
      tx_hash: '9f8e7d6c5b4a3928170f1e2d3c4b5a69f8e7d6c5b4a3928170f1e2d3c4b5a678',
      ledger: 987654,
      payer: 'GBEXAMPLEPAYERADDRESS9876543210ABCDEFGHIJKLMNO56789',
      amount: '5000000',
      asset: 'USDC',
      ts: '2026-08-26T06:00:00.000Z',
      route: '/api/v1/checkout',
      method: 'POST',
    };

    const html = renderToString(
      <PaymentModal
        selected={payment}
        onClose={() => {}}
        refunded={new Set()}
        onRefunded={() => {}}
      />,
    );

    // Assert full untruncated values are present in DOM
    expect(html).toContain('9f8e7d6c5b4a3928170f1e2d3c4b5a69f8e7d6c5b4a3928170f1e2d3c4b5a678');
    expect(html).toContain('GBEXAMPLEPAYERADDRESS9876543210ABCDEFGHIJKLMNO56789');

    // Assert Copy affordance buttons with accessible labels
    expect(html).toContain('aria-label="Copy Transaction Hash"');
    expect(html).toContain('aria-label="Copy Payer Address"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
