// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnchorPanel } from './anchor-panel';

// Mock submitAnchor to control signing outcome
vi.mock('@lib/anchor-submit', () => ({
  submitAnchor: vi.fn(),
}));

// Mock freighter library
vi.mock('@lib/freighter', () => ({
  readStatus: vi.fn().mockResolvedValue({ kind: 'connected', address: 'GABC' }),
  connect: vi.fn().mockResolvedValue({ kind: 'connected', address: 'GABC' }),
  FREIGHTER_INSTALL_URL: 'https://freighter.app',
}));

describe('AnchorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders idle state and triggers preview load', async () => {
    const previewData = {
      count: 2,
      merchant: 'GABC',
      contractId: 'C123',
      networkPassphrase: 'Test SDF Network',
      maxBatchSize: 1000,
      selectionHash: 'a'.repeat(64),
      root: 'b'.repeat(64),
      periodStart: 1000,
      periodEnd: 2000,
      startLedger: 10,
      endLedger: 20,
      payments: [
        {
          tx_hash: '1'.repeat(64),
          leaf: 'c'.repeat(64),
          ledger: 10,
          ts: '2026-08-01T00:00:00.000Z',
          amount: '100',
        },
      ],
      existing: null,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => previewData,
      }),
    );

    render(<AnchorPanel />);
    expect(screen.getByText(/anchor/i)).toBeDefined();

    const previewButton = screen.getByRole('button', { name: /preview batch/i });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(screen.getByText(/2 payments/i)).toBeDefined();
    });
  });

  it('surfaces thrown error state when preview load fails with non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database offline' }),
      }),
    );

    render(<AnchorPanel />);
    const previewButton = screen.getByRole('button', { name: /preview batch/i });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(screen.getByText(/Database offline/i)).toBeDefined();
    });
  });

  it('jumps straight to recording without re-submitting when preview existing batchId is submitted, avoiding duplicate submits', async () => {
    const previewData = {
      count: 1,
      merchant: 'GABC',
      contractId: 'C123',
      networkPassphrase: 'Test SDF Network',
      maxBatchSize: 1000,
      selectionHash: 'a'.repeat(64),
      root: 'b'.repeat(64),
      periodStart: 1000,
      periodEnd: 2000,
      startLedger: 10,
      endLedger: 20,
      payments: [],
      existing: { batchId: 42, status: 'submitted' as const, anchorTx: 'd'.repeat(64) },
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/anchor/preview') {
        return {
          ok: true,
          json: async () => previewData,
        };
      }
      if (url === '/api/anchor/record') {
        return {
          ok: true,
          json: async () => ({ success: true, batchId: 42 }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview batch/i }));

    await waitFor(() => {
      expect(screen.getByText(/batch #42/i)).toBeDefined();
    });

    // Confirm / trigger action
    const confirmButton = screen.getByRole('button', { name: /anchor batch/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const recordCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/anchor/record');
      expect(recordCalls.length).toBe(1);
    });
  });

  it('renders recovery message naming the batchId when recording fails', async () => {
    const previewData = {
      count: 1,
      merchant: 'GABC',
      contractId: 'C123',
      networkPassphrase: 'Test SDF Network',
      maxBatchSize: 1000,
      selectionHash: 'a'.repeat(64),
      root: 'b'.repeat(64),
      periodStart: 1000,
      periodEnd: 2000,
      startLedger: 10,
      endLedger: 20,
      payments: [],
      existing: { batchId: 99, status: 'submitted' as const, anchorTx: 'd'.repeat(64) },
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/anchor/preview') {
        return {
          ok: true,
          json: async () => previewData,
        };
      }
      if (url === '/api/anchor/record') {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: 'Ledger timeout' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview batch/i }));

    await waitFor(() => {
      expect(screen.getByText(/batch #99/i)).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /anchor batch/i }));

    await waitFor(() => {
      expect(screen.getByText(/retry recording without submitting again/i)).toBeDefined();
      expect(screen.getByText(/#99/i)).toBeDefined();
    });
  });
});
