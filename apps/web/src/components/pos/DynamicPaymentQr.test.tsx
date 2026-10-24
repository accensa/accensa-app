// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DynamicPaymentQr } from './DynamicPaymentQr';

describe('DynamicPaymentQr', () => {
  const defaultProps = {
    paymentUri: 'stellar:pay?destination=G...&amount=10&asset=USDC',
    amount: '10.00',
    asset: 'USDC',
    validitySeconds: 5,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the pending QR on mount with a future expiry and awaiting status', () => {
    render(<DynamicPaymentQr {...defaultProps} />);

    expect(screen.getByText('10.00 USDC')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
    expect(screen.getByText('Expires in')).toBeInTheDocument();
    expect(screen.getByText('Copy Link')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh QR' })).not.toBeInTheDocument();
  });

  it('advancing the clock to expiry renders the expired state and a Refresh action', () => {
    render(<DynamicPaymentQr {...defaultProps} validitySeconds={2} />);

    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh QR' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Refresh QR' })).toBeInTheDocument();
  });

  it('activates Refresh and returns the component to the pending state with a fresh expiresAt', () => {
    render(<DynamicPaymentQr {...defaultProps} validitySeconds={2} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
    const refreshButton = screen.getByRole('button', { name: 'Refresh QR' });

    fireEvent.click(refreshButton);

    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh QR' })).not.toBeInTheDocument();
    expect(screen.getByText('Expires in')).toBeInTheDocument();
  });

  it('simulates confirmed payment deterministically when Math.random returns a high value', async () => {
    const onConfirmed = vi.fn();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    render(<DynamicPaymentQr {...defaultProps} onPaymentConfirmed={onConfirmed} />);

    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('Payment Confirmed!')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
});
