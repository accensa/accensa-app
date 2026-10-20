// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaxLineItem from './TaxLineItem';
import TipSelector from './TipSelector';
import { CheckoutProvider } from '../../context/CheckoutContext';

describe('TaxLineItem Component', () => {
  it('renders EU VAT line item with percentage and calculated amount', () => {
    render(<TaxLineItem subtotal={100} country="DE" rule={{ type: 'EU_VAT' }} />);

    expect(screen.getByTestId('checkout-tax-line')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-tax-label')).toHaveTextContent(
      'Estimated VAT (EU-DE) (19.00%)',
    );
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$19.00');
  });

  it('renders US State Sales Tax line item with postal code lookup', () => {
    render(
      <TaxLineItem subtotal={200} country="US" postalCode="90210" rule={{ type: 'US_STATE' }} />,
    );

    expect(screen.getByTestId('checkout-tax-label')).toHaveTextContent(
      'Estimated Sales Tax (US-CA) (7.25%)',
    );
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$14.50');
  });

  it('fires onTaxCalculated callback with breakdown data', () => {
    const handleTaxCalculated = vi.fn();
    render(
      <TaxLineItem
        subtotal={50}
        country="FR"
        rule={{ type: 'EU_VAT' }}
        onTaxCalculated={handleTaxCalculated}
      />,
    );

    expect(handleTaxCalculated).toHaveBeenCalledWith(
      expect.objectContaining({
        jurisdiction: 'EU-FR',
        amount: 10.0,
        rate: 0.2,
      }),
    );
  });

  it('integrates cleanly into TipSelector checkout totals summary', () => {
    render(
      <CheckoutProvider subtotal={100} tipEnabled={true}>
        <TipSelector country="DE" taxRule={{ type: 'EU_VAT' }} />
      </CheckoutProvider>,
    );

    expect(screen.getByTestId('checkout-subtotal')).toHaveTextContent('100.00');
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$19.00');
    // Total reflects subtotal + tip (0) + tax (19) = 119.00
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('119.00');
  });

  it('keeps tax line and total available even when tipEnabled is false', () => {
    render(
      <CheckoutProvider subtotal={100} tipEnabled={false}>
        <TipSelector country="DE" taxRule={{ type: 'EU_VAT' }} />
      </CheckoutProvider>,
    );

    expect(screen.getByTestId('checkout-subtotal')).toHaveTextContent('100.00');
    expect(screen.getByTestId('checkout-tax-amount')).toHaveTextContent('$19.00');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('119.00');
  });
});
