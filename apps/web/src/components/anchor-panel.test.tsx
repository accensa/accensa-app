// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnchorPanel } from './anchor-panel';

describe('AnchorPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders idle state and triggers preview', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 5, existing: null }),
    } as Response);

    render(<AnchorPanel />);
    expect(screen.getByText(/anchor/i)).toBeInTheDocument();

    const previewButton = screen.getByRole('button', { name: /preview/i });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('handles preview load failure with non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    } as Response);

    render(<AnchorPanel />);
    const previewButton = screen.getByRole('button', { name: /preview/i });
    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(screen.getByText(/failed to load preview/i)).toBeInTheDocument();
    });
  });

  it('jumps straight to recording without re-submitting when preview has existing batchId', async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.toString().includes('preview')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 2, existing: { batchId: '123' } }),
        });
      }
      if (url.toString().includes('record')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    vi.stubGlobal('fetch', mockFetch);

    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(screen.getByText(/batch is on-chain/i)).toBeInTheDocument();
    });

    // Verify submit endpoint was NOT called separately since existing batchId was present
    const submitCalls = mockFetch.mock.calls.filter((call) =>
      call[0].toString().includes('submit'),
    );
    expect(submitCalls.length).toBe(0);
  });

  it('shows recovery message with batchId on recording failure', async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (url.toString().includes('preview')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ count: 2, existing: { batchId: '456' } }),
        });
      }
      if (url.toString().includes('record')) {
        return Promise.resolve({
          ok: false,
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    vi.stubGlobal('fetch', mockFetch);

    render(<AnchorPanel />);
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /The batch is on-chain as #456; retry recording without submitting again/i,
        ),
      ).toBeInTheDocument();
    });
  });
});
