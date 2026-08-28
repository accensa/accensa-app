import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RefundPanelView } from './refund-panel';

type Phase = Parameters<typeof RefundPanelView>[0]['phase'];

const payment = {
  tx_hash: 'a'.repeat(64),
  payer: `GA${'B'.repeat(54)}`,
  amount: '10.0000000',
  asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  ledger: 42,
};

const noop = () => {};

function render(phase: Phase) {
  return renderToString(
    <RefundPanelView
      phase={phase}
      merchant="GMERCHANT"
      payment={payment}
      error={null}
      onCheck={noop}
      onConfirm={noop}
      onReset={noop}
    />,
  );
}

describe('RefundPanelView', () => {
  it('offers the refund action while idle', () => {
    expect(render({ kind: 'idle' })).toContain('Refund this payment');
  });

  it('disables the control while a preflight check runs', () => {
    const html = render({ kind: 'checking' });
    expect(html).toContain('Checking…');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('exposes no refund control at all while a refund is submitting', () => {
    const html = render({ kind: 'submitting' });

    // No button — nothing that could start a second, doomed refund.
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Refund this payment');
    // And it says why: a wallet prompt is open.
    expect(html.toLowerCase()).toContain('signing prompt is open');
  });

  it('renders the outcome once done, with an explorer link', () => {
    const html = render({ kind: 'done', outcome: { status: 'confirmed', hash: 'DEADBEEF' } });
    expect(html).toContain('Refund confirmed on-chain');
    expect(html).toContain('/tx/DEADBEEF');
  });
});

// Compile-time contract: `RefundPanelView` handles every `Phase` in an
// exhaustive `switch`, and its `default` branch calls `assertNever(phase)`.
// Adding a variant to `Phase` without a matching `case` narrows `phase` to that
// variant instead of `never`, so `assertNever` stops type-checking and the
// `typecheck` CI job fails. That is the guardrail this bug (a missing
// `submitting` case) needed; there is no runtime test that can stand in for it.
