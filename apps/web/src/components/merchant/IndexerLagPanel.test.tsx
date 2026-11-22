// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexerLagPanel } from './IndexerLagPanel';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('IndexerLagPanel', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders worst status, lag and readable sync age for a 200 ok body without alert styling', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'ok',
        head: 12345,
        checkedAt: new Date(NOW).toISOString(),
        merchants: [
          {
            merchantId: 7,
            lastLedger: 12340,
            lastSyncedAt: new Date(NOW - 5 * 60_000).toISOString(),
            lagLedgers: 5,
            ageMs: 5 * 60_000,
            status: 'ok',
            reasons: [],
          },
        ],
      }),
    );

    render(<IndexerLagPanel />);

    await waitFor(() => expect(screen.getByText('Merchant 7')).toBeInTheDocument());
    expect(screen.getAllByText(/Worst status: ok/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Lag: 5 ledgers behind')).toBeInTheDocument();
    expect(screen.getByText('Sync age: 5 min ago')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('treats a 503 critical body as data and still lists merchants with their reasons', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          status: 'critical',
          head: 100000,
          checkedAt: new Date(NOW).toISOString(),
          merchants: [
            {
              merchantId: 1,
              lastLedger: 10000,
              lastSyncedAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
              lagLedgers: 90000,
              ageMs: 2 * 60 * 60_000,
              status: 'critical',
              reasons: ['cursor lag 90000 >= 90000 ledgers'],
            },
            {
              merchantId: 2,
              lastLedger: null,
              lastSyncedAt: null,
              lagLedgers: null,
              ageMs: null,
              status: 'warn',
              reasons: [],
            },
          ],
        },
        503,
      ),
    );

    render(<IndexerLagPanel />);

    await waitFor(() => expect(screen.getByText('Merchant 1')).toBeInTheDocument());
    expect(screen.getAllByText(/Worst status: critical/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Lag: 90,000 ledgers behind')).toBeInTheDocument();
    expect(screen.getByText('Sync age: 2 hr ago')).toBeInTheDocument();
    expect(screen.getByText('cursor lag 90000 >= 90000 ledgers')).toBeInTheDocument();
    expect(screen.getByText('Merchant 2')).toBeInTheDocument();
    expect(screen.getByText('Lag: No cursor yet')).toBeInTheDocument();
    expect(screen.getByText('Sync age: No cursor yet')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('falls back to lastSyncedAt when ageMs is missing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 'warn',
        merchants: [
          {
            merchantId: 3,
            lastLedger: 10,
            lastSyncedAt: new Date(NOW - 10 * 60_000).toISOString(),
            lagLedgers: 0,
            ageMs: null,
            status: 'warn',
            reasons: ['no successful sync in 10 min'],
          },
        ],
      }),
    );

    render(<IndexerLagPanel />);

    await waitFor(() => expect(screen.getByText('Sync age: 10 min ago')).toBeInTheDocument());
    expect(screen.getByText('Lag: 0 ledgers behind')).toBeInTheDocument();
  });

  it('shows a failure with retry and refetches when retry is pressed', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'ok',
          merchants: [
            {
              merchantId: 4,
              lastLedger: 100,
              lastSyncedAt: null,
              lagLedgers: 10,
              ageMs: null,
              status: 'ok',
              reasons: [],
            },
          ],
        }),
      );

    render(<IndexerLagPanel />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network down'));
    expect(screen.queryByText('Merchant 4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Merchant 4')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Sync age: No cursor yet')).toBeInTheDocument();
  });

  it('aborts the in-flight request on unmount', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(global, 'fetch').mockImplementation((_input, init) => {
      signal = (init as RequestInit).signal as AbortSignal;
      return new Promise(() => {});
    });

    const { unmount } = render(<IndexerLagPanel />);
    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
