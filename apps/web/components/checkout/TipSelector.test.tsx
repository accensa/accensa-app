// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TipSelector from './TipSelector';
import { CheckoutProvider } from '../../context/CheckoutContext';

function renderWithProvider(subtotal: number, tipEnabled = true) {
  return render(
    <CheckoutProvider subtotal={subtotal} tipEnabled={tipEnabled}>
      <TipSelector />
    </CheckoutProvider>,
  );
}

describe('TipSelector', () => {
  it('renders nothing when the merchant disabled tipping', () => {
    renderWithProvider(100, false);
    expect(screen.queryByTestId('tip-selector')).toBeNull();
  });

  it('renders quick percentage options and a running total', () => {
    renderWithProvider(100);
    expect(screen.getByRole('button', { name: '10%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20%' })).toBeInTheDocument();
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('100.00');
  });

  it('updates the total when a percentage is selected', () => {
    renderWithProvider(100);
    fireEvent.click(screen.getByRole('button', { name: '15%' }));
    expect(screen.getByTestId('checkout-tip')).toHaveTextContent('15.00');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('115.00');
    expect(screen.getByRole('button', { name: '15%' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('accepts a custom tip amount', () => {
    renderWithProvider(100);
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Custom tip amount'), { target: { value: '7.5' } });
    expect(screen.getByTestId('checkout-tip')).toHaveTextContent('7.50');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('107.50');
  });

  it('resets to no tip', () => {
    renderWithProvider(100);
    fireEvent.click(screen.getByRole('button', { name: '20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'No tip' }));
    expect(screen.getByTestId('checkout-tip')).toHaveTextContent('0.00');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('100.00');
  });
});
