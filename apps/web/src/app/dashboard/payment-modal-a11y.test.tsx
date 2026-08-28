import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PaymentModal } from './page';

const payment = {
  tx_hash: 'f'.repeat(64),
  ledger: 123,
  payer: 'GBEXAMPLEPAYER',
  amount: '1000',
  asset: 'USDC',
  ts: '2026-08-26T00:00:00.000Z',
  route: '/api/pay',
  method: 'GET',
};

function render() {
  return renderToString(
    <PaymentModal
      selected={payment}
      onClose={() => {}}
      refunded={new Set()}
      onRefunded={() => {}}
    />,
  );
}

describe('PaymentModal dialog semantics', () => {
  it('is announced as a modal dialog with an accessible name', () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="payment-details-heading"');
    expect(html).toContain('id="payment-details-heading"');
    expect(html).toContain('Payment Details');
  });

  it('gives the dialog container a focus target and labels the close control', () => {
    const html = render();
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Close payment details"');
  });
});

// Focus trapping (wrapTabTarget) and focus restoration (focusRestorer) — the
// two behaviours PaymentModal's effect wires up — are unit-tested in
// `lib/dialog-focus.test.ts`. A full mount-and-Tab integration test would need
// jsdom, which this project's Node test setup does not include.
