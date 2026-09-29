// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SubscriptionCard from './SubscriptionCard';
import {
  createSubscriptionPlan,
  startSubscription,
  cancelAtPeriodEnd,
} from '@accensa/sdk/subscription';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function plan() {
  return createSubscriptionPlan(
    {
      merchantId: 'm1',
      name: 'Pro',
      amount: '10.0000000',
      asset: 'USDC',
      billingInterval: 'monthly',
    },
    'plan-1',
    NOW,
  );
}

describe('SubscriptionCard', () => {
  it('renders plan details and the next billing date', () => {
    const p = plan();
    const sub = startSubscription(p, 'GCUSTOMER', 'sub-1', NOW);
    render(<SubscriptionCard plan={p} subscription={sub} />);
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByTestId('subscription-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('subscription-next-billing')).toHaveTextContent('Feb 1, 2026');
  });

  it('shows a cancel button and calls the handler with true', () => {
    const p = plan();
    const sub = startSubscription(p, 'GCUSTOMER', 'sub-1', NOW);
    const onToggle = vi.fn();
    render(<SubscriptionCard plan={p} subscription={sub} onToggleCancel={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('offers to keep the subscription once cancellation is pending', () => {
    const p = plan();
    const sub = cancelAtPeriodEnd(startSubscription(p, 'GCUSTOMER', 'sub-1', NOW));
    render(<SubscriptionCard plan={p} subscription={sub} onToggleCancel={vi.fn()} />);
    expect(screen.getByText(/Cancels at the end/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep subscription' })).toBeInTheDocument();
  });

  it('hides the toggle button once the subscription has ended', () => {
    const p = plan();
    const sub: import('@accensa/sdk/subscription').Subscription = {
      ...startSubscription(p, 'GCUSTOMER', 'sub-1', NOW),
      status: 'expired',
    };
    render(<SubscriptionCard plan={p} subscription={sub} onToggleCancel={vi.fn()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
