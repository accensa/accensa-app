// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FunnelChart from './FunnelChart';
import { aggregateFunnel, type CheckoutEvent } from '../../src/lib/funnel';

const ev = (id: string, step: CheckoutEvent['step']): CheckoutEvent => ({
  sessionId: id,
  step,
  ts: 1,
  device: 'desktop',
  wallet: 'freighter',
});

describe('FunnelChart', () => {
  it('renders every step with counts and drop-off, marking the bottleneck', () => {
    const events = [
      ev('a', 'checkout_opened'),
      ev('a', 'wallet_connected'),
      ev('a', 'authorization_approved'),
      ev('a', 'payment_settled'),
      ev('b', 'checkout_opened'),
      ev('c', 'checkout_opened'),
      ev('d', 'checkout_opened'),
    ];
    render(<FunnelChart funnel={aggregateFunnel(events)} />);
    expect(screen.getByRole('img', { name: 'Checkout conversion funnel' })).toBeInTheDocument();
    expect(screen.getByTestId('funnel-step-checkout_opened')).toHaveTextContent('4 sessions');
    // 4 -> 1 is the largest drop (75%).
    expect(screen.getByTestId('funnel-step-wallet_connected')).toHaveTextContent('−75.0% drop');
    expect(
      screen.getByTestId('funnel-step-wallet_connected').querySelector('rect'),
    ).toHaveAttribute('fill', '#dc2626');
  });

  it('renders an empty funnel without NaN', () => {
    const { container } = render(<FunnelChart funnel={aggregateFunnel([])} />);
    expect(container.innerHTML).not.toContain('NaN');
    expect(screen.getByTestId('funnel-step-payment_settled')).toHaveTextContent('0 sessions');
  });
});
