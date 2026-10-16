// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsTable, PaymentsCardList, paymentLabel } from './payment-rows';
import type { Payment } from './payments-merge';

const mockPayment1: Payment = {
  tx_hash: '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
  ledger: 123456,
  payer: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2UROWVOQ2HSOZDTHJZG5Z',
  amount: '125.50',
  asset: 'USDC',
  ts: '2026-10-16T08:30:00Z',
  route: '/api/checkout',
  method: 'POST',
  risk_score: 12,
  risk_country_code: 'US',
};

const mockPayment2: Payment = {
  tx_hash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  ledger: 123457,
  payer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  amount: '500.00',
  asset: null,
  ts: '2026-10-16T09:00:00Z',
  route: null,
  method: null,
  risk_score: 85,
  risk_country_code: 'NG',
};

describe('PaymentsTable component accessibility and structure (#529)', () => {
  it('renders a table structure with proper row, columnheader, and cell semantics', () => {
    const onSelect = vi.fn();
    const refunded = new Set<string>();

    render(
      <PaymentsTable
        payments={[mockPayment1, mockPayment2]}
        refunded={refunded}
        onSelect={onSelect}
      />,
    );

    // 1. Table structure exists
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // 2. Column headers are accessible
    const columnHeaders = screen.getAllByRole('columnheader');
    expect(columnHeaders).toHaveLength(6);
    expect(columnHeaders.map((th) => th.textContent?.trim())).toEqual([
      'Transaction',
      'Amount',
      'Payer',
      'Route',
      'Time',
      'Risk',
    ]);

    // 3. Rows retain their implicit 'row' role and are NOT overridden with role="button"
    const rows = screen.getAllByRole('row');
    // 1 header row + 2 data rows
    expect(rows).toHaveLength(3);

    // Verify data rows do NOT have role="button" or tabIndex="0"
    const dataRows = rows.slice(1);
    for (const row of dataRows) {
      expect(row.getAttribute('role')).toBeNull();
      expect(row.getAttribute('tabindex')).toBeNull();
    }

    // 4. Cells stay associated with table rows
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(12); // 6 cells per row * 2 rows
  });

  it('renders an in-row focusable button control with accessible name preserving click, Enter, and Space', () => {
    const onSelect = vi.fn();
    const refunded = new Set<string>();

    render(<PaymentsTable payments={[mockPayment1]} refunded={refunded} onSelect={onSelect} />);

    const button = screen.getByRole('button', {
      name: paymentLabel(mockPayment1),
    });
    expect(button).toBeInTheDocument();

    // Mouse click on button
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockPayment1);

    // Keyboard Enter on button
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);

    // Keyboard Space on button
    fireEvent.keyDown(button, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('allows mouse activation by clicking anywhere on the table row', () => {
    const onSelect = vi.fn();
    const refunded = new Set<string>();

    render(<PaymentsTable payments={[mockPayment1]} refunded={refunded} onSelect={onSelect} />);

    // Click on another cell within the row (e.g. amount or time cell)
    const amountCell = screen.getByText('125.50');
    fireEvent.click(amountCell);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockPayment1);
  });

  it('renders refunded badge without breaking table row semantics', () => {
    const onSelect = vi.fn();
    const refunded = new Set<string>([mockPayment1.tx_hash]);

    render(<PaymentsTable payments={[mockPayment1]} refunded={refunded} onSelect={onSelect} />);

    expect(screen.getByText('Refunded')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2); // header + data row
    expect(rows[1].getAttribute('role')).toBeNull();
  });
});

describe('PaymentsCardList component (#529)', () => {
  it('keeps its button role and keyboard activation on mobile cards', () => {
    const onSelect = vi.fn();

    render(<PaymentsCardList payments={[mockPayment1]} onSelect={onSelect} />);

    const cardButton = screen.getByRole('button', {
      name: paymentLabel(mockPayment1),
    });
    expect(cardButton).toBeInTheDocument();
    expect(cardButton.getAttribute('tabindex')).toBe('0');

    // Click card
    fireEvent.click(cardButton);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(mockPayment1);

    // Keyboard Enter on card
    fireEvent.keyDown(cardButton, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);

    // Keyboard Space on card
    fireEvent.keyDown(cardButton, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});
