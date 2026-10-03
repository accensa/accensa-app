// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WebhookDeliveryViewer from './WebhookDeliveryViewer';

const deliveryData = {
  configured: true,
  pending: 0,
  failed: 0,
  deadLetter: 1,
  delivered: 3,
  lag: 0,
  recentDeliveries: [
    {
      id: 12,
      paymentTxHash: 'a'.repeat(64),
      payload: { amount: '1.00', route: '/checkout' },
      status: 'dead_letter',
      attempts: 4,
      lastStatusCode: 503,
      lastError: 'HTTP 503',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:05:00.000Z',
      attemptHistory: [
        {
          attemptNumber: 4,
          statusCode: 503,
          error: 'HTTP 503',
          durationMs: 120,
          createdAt: '2026-10-01T10:05:00.000Z',
        },
      ],
    },
  ],
};

describe('WebhookDeliveryViewer', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(deliveryData), { status: 200 }),
    );
  });

  it('shows delivery status and expandable payload and attempt history', async () => {
    render(<WebhookDeliveryViewer />);

    expect(await screen.findByText('dead letter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show details for delivery 12' }));

    expect(screen.getByText('Payload')).toBeInTheDocument();
    expect(screen.getByText(/"route": "\/checkout"/)).toBeInTheDocument();
    expect(screen.getByText('Attempt 4')).toBeInTheDocument();
    expect(screen.getAllByText('120 ms', { exact: false })).toHaveLength(2);
  });

  it('queues a redelivery and reports the outcome', async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ queued: true }), { status: 202 });
      return new Response(JSON.stringify(deliveryData), { status: 200 });
    });
    render(<WebhookDeliveryViewer />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show details for delivery 12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redeliver event' }));

    expect(await screen.findByRole('status')).toHaveTextContent('queued for redelivery');
    expect(fetchMock).toHaveBeenCalledWith('/api/webhooks/12', { method: 'POST' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('propagates meaningful API errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 }),
    );
    render(<WebhookDeliveryViewer />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired');
  });
});