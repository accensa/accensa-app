// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiatPriceDisplay } from './FiatPriceDisplay';

const snapshot = {
  xlmUsd: 25,
  usdcUsd: 1,
  fiatPerUsd: { USD: 1, EUR: 1.2, GBP: 0.8, NGN: 1500, BRL: 5, JPY: 150 },
  fetchedAt: '2026-10-18T00:00:00.000Z',
  provider: 'test rates',
};

function ratesResponse(body: typeof snapshot) {
  return { ok: true, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('FiatPriceDisplay', () => {
  it('converts fiat and XLM/USDC values from a successful rates response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ratesResponse(snapshot)));
    render(<FiatPriceDisplay amountUsd={100} />);

    await screen.findByText(/test rates/);
    expect(screen.getByText('~$100.00')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Fiat currency' }), {
      target: { value: 'EUR' },
    });
    expect(screen.getByText('~120,00 €')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'crypto' }));
    expect(screen.getByText('~4.0000 XLM')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    expect(screen.getByText('~100.00 USDC')).toBeInTheDocument();
  });

  it('uses a cached snapshot as stale when the fetch fails', async () => {
    localStorage.setItem('accensa.exchange-rates.v1', JSON.stringify(snapshot));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    render(<FiatPriceDisplay amountUsd={100} />);

    expect(await screen.findByText(/cached/)).toBeInTheDocument();
    expect(screen.getByText('~$100.00')).toBeInTheDocument();
  });

  it('shows unavailable when there is no cached snapshot and ignores malformed storage', async () => {
    localStorage.setItem('accensa.exchange-rates.v1', '{not json');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    render(<FiatPriceDisplay amountUsd={100} />);

    await waitFor(() => expect(screen.getByText('~Rates unavailable')).toBeInTheDocument());
  });
});
