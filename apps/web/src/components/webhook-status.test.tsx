// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookStatus } from './webhook-status';
import { useOnline } from '@/components/network-status';

vi.mock('@/components/network-status', () => ({
  useOnline: vi.fn(),
}));

const mockUseOnline = vi.mocked(useOnline);

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe('WebhookStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing and issues no fetch while offline', async () => {
    mockUseOnline.mockReturnValue(false);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}));

    const { container } = render(<WebhookStatus />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders null when the summary is unconfigured', async () => {
    mockUseOnline.mockReturnValue(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ configured: false, pending: 0, failed: 0, delivered: 0, recentFailed: [] }),
    );

    const { container } = render(<WebhookStatus />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders null when there are zero failed and zero pending deliveries', async () => {
    mockUseOnline.mockReturnValue(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ configured: true, pending: 0, failed: 0, delivered: 10, recentFailed: [] }),
    );

    const { container } = render(<WebhookStatus />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the banner with correct pluralization and at most five recent failures', async () => {
    mockUseOnline.mockReturnValue(true);
    const recentFailed = Array.from({ length: 6 }, (_, i) => ({
      id: i,
      paymentTxHash: `hash-${i}-0000000000000000`,
      attempts: 1,
      lastStatusCode: null,
      lastError: null,
    }));
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ configured: true, pending: 0, failed: 6, delivered: 0, recentFailed }),
    );

    render(<WebhookStatus />);

    await waitFor(() => expect(screen.getByTestId('webhook-status')).toBeDefined());
    expect(screen.getByText(/6 deliveries failed after the retry window\./)).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('renders singular wording for a single failed delivery', async () => {
    mockUseOnline.mockReturnValue(true);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        configured: true,
        pending: 0,
        failed: 1,
        delivered: 0,
        recentFailed: [
          {
            id: 1,
            paymentTxHash: '0123456789abcdef',
            attempts: 1,
            lastStatusCode: null,
            lastError: null,
          },
        ],
      }),
    );

    render(<WebhookStatus />);

    await waitFor(() =>
      expect(screen.getByText(/1 delivery failed after the retry window\./)).toBeDefined(),
    );
  });

  it('aborts the in-flight fetch when unmounted before the response resolves', async () => {
    mockUseOnline.mockReturnValue(true);
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      capturedSignal = (init as RequestInit)?.signal as AbortSignal;
      return new Promise(() => {});
    });

    const { unmount } = render(<WebhookStatus />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
