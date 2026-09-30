import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { SplitPaymentSelector } from './SplitPaymentSelector';

describe('SplitPaymentSelector Component', () => {
  const defaultBalances = {
    usdc: '100.0000000',
    xlm: '1000.0000000',
  };

  const defaultRates = {
    xlmUsdRate: 0.12,
    usdcUsdRate: 1.0,
  };

  it('renders the split payment selector with header, total, and live rates', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={50.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
        initialUsdcPercentage={50}
      />,
    );

    expect(html).toContain('Split Tender Payment');
    expect(html).toContain('$50.00');
    expect(html).toContain('1 XLM = $0.1200 USD');
    expect(html).toContain('Slippage Protection:');
    expect(html).toContain('±1%');
  });

  it('renders the allocation slider with accessible ARIA attributes', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={50.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
        initialUsdcPercentage={50}
      />,
    );

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('USDC: 50%');
    expect(html).toContain('XLM: 50%');
  });

  it('renders quick split presets including 100% USDC, 50/50, and Optimal Split', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={50.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
      />,
    );

    expect(html).toContain('100% USDC');
    expect(html).toContain('75 / 25');
    expect(html).toContain('50 / 50');
    expect(html).toContain('25 / 75');
    expect(html).toContain('100% XLM');
    expect(html).toContain('Optimal Split');
  });

  it('displays accurate payment amounts in USDC and XLM breakdown cards', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={100.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
        initialUsdcPercentage={50}
      />,
    );

    // At $100 total with 50% split:
    // USDC: $50 = 50.0000000 USDC
    // XLM: $50 at $0.12 = 416.6666667 XLM
    expect(html).toContain('50.0000000 USDC');
    expect(html).toContain('416.6666667 XLM');
    expect(html).toContain('Wallet Balance:');
    expect(html).toContain('100% Covered');
  });

  it('displays slippage-adjusted maximum deduction for XLM portion', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={100.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
        initialUsdcPercentage={0} // 100% XLM = 833.3333333 XLM
        slippageTolerancePercent={1.0}
      />,
    );

    expect(html).toContain('Max with Slippage:');
    // 833.3333333 * 1.01 = 841.6666667
    expect(html).toContain('841.6666667 XLM');
  });

  it('flags insufficient balance with warning and disables submit when customer cannot afford', () => {
    const lowBalances = {
      usdc: '10.0', // Needs 25 for a 50% split on $50
      xlm: '50.0', // Needs 208.3333333 XLM
    };

    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={50.0}
        customerBalances={lowBalances}
        exchangeRates={defaultRates}
        initialUsdcPercentage={50}
      />,
    );

    expect(html).toContain('Insufficient USDC balance');
    expect(html).toContain('Insufficient XLM balance');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('strictly adheres to Accensa design standards (sharp corners, no rounded-* classes)', () => {
    const html = renderToString(
      <SplitPaymentSelector
        totalAmountUsd={50.0}
        customerBalances={defaultBalances}
        exchangeRates={defaultRates}
      />,
    );

    expect(html).not.toContain('rounded-lg');
    expect(html).not.toContain('rounded-full');
    expect(html).not.toContain('rounded-md');
    expect(html).not.toContain('rounded-sm');
    expect(html).not.toContain('rounded-xl');
  });
});
