// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentRow } from '@/app/api/payments/route';

const { mockFetchAllPayments } = vi.hoisted(() => ({ mockFetchAllPayments: vi.fn() }));

vi.mock('@/lib/payments-fetch', () => ({ fetchAllPayments: mockFetchAllPayments }));
vi.mock('@/components/network-status', () => ({ useOnline: () => true }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import GasAnalyticsPage from './page';

function payment(n: number, feeStroops: string | null): PaymentRow {
  return {
    tx_hash: n.toString(16).padStart(64, '0'),
    ledger: 100,
    payer: 'G' + 'A'.repeat(55),
    amount: '10',
    asset: 'XLM',
    ts: '2026-09-01T10:00:00Z',
    route: '/api/pay',
    method: 'POST',
    fee_stroops: feeStroops,
  };
}

function history(payments: PaymentRow[]) {
  return { payments, sync: null, truncated: false };
}

describe('gas analytics uses observed fees only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAllPayments.mockResolvedValue(history([]));
  });

  it('totals 100 and 5,000 stroops differently', async () => {
    mockFetchAllPayments.mockResolvedValueOnce(history([payment(1, '100')]));
    const first = render(<GasAnalyticsPage />);
    await waitFor(() =>
      expect(screen.getByText(/100 stroops across 1 transactions/)).toBeInTheDocument(),
    );
    first.unmount();

    mockFetchAllPayments.mockResolvedValueOnce(history([payment(1, '100'), payment(2, '5000')]));
    render(<GasAnalyticsPage />);
    await waitFor(() =>
      expect(screen.getAllByText(/5100 stroops across 2 transactions/).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/2550 stroops/)).toBeInTheDocument();
  });

  it('excludes unpriced payments from the total and counts them', async () => {
    mockFetchAllPayments.mockResolvedValueOnce(
      history([payment(1, '100'), payment(2, null), payment(3, null)]),
    );
    render(<GasAnalyticsPage />);

    await waitFor(() =>
      expect(screen.getByText(/100 stroops across 1 transactions/)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/1 priced payments · 2 unpriced payments excluded/),
    ).toBeInTheDocument();
  });

  it('reports zero priced payments when no fee was observed', async () => {
    mockFetchAllPayments.mockResolvedValueOnce(history([payment(1, null)]));
    render(<GasAnalyticsPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/0 priced payments · 1 unpriced payments excluded/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/0 stroops across 0 transactions/)).toBeInTheDocument();
  });
});
