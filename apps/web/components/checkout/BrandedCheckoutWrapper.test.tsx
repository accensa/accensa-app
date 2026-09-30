// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BrandedCheckoutWrapper from './BrandedCheckoutWrapper';
import { DEFAULT_BRANDING } from '../../src/lib/branding';

describe('BrandedCheckoutWrapper', () => {
  it('injects the brand custom properties and renders children', () => {
    render(
      <BrandedCheckoutWrapper branding={{ ...DEFAULT_BRANDING, accentColor: '#1e3a8a' }}>
        <button>Pay</button>
      </BrandedCheckoutWrapper>,
    );
    const root = screen.getByTestId('branded-checkout');
    expect(root.style.getPropertyValue('--brand-primary')).toBe('#1e3a8a');
    expect(root.style.getPropertyValue('--brand-font')).toContain('system-ui');
    expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument();
  });

  it('shows a logo only when one is set', () => {
    const { rerender } = render(
      <BrandedCheckoutWrapper branding={DEFAULT_BRANDING}>x</BrandedCheckoutWrapper>,
    );
    expect(screen.queryByRole('img', { name: 'Merchant logo' })).toBeNull();
    rerender(
      <BrandedCheckoutWrapper
        branding={{ ...DEFAULT_BRANDING, logoDataUrl: 'data:image/png;base64,AAAA' }}
      >
        x
      </BrandedCheckoutWrapper>,
    );
    expect(screen.getByRole('img', { name: 'Merchant logo' })).toBeInTheDocument();
  });

  it('adapts the accent for dark mode', () => {
    render(
      <BrandedCheckoutWrapper
        branding={{ ...DEFAULT_BRANDING, accentColor: '#1e3a8a' }}
        mode="dark"
      >
        x
      </BrandedCheckoutWrapper>,
    );
    expect(
      screen.getByTestId('branded-checkout').style.getPropertyValue('--brand-primary'),
    ).not.toBe('#1e3a8a');
  });
});
