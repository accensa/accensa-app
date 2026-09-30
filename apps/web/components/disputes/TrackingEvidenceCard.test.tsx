// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TrackingEvidenceCard from './TrackingEvidenceCard';

const inTransitTracking = {
  carrier: 'UPS' as const,
  trackingNumber: '1Z999AA10123456784',
  status: 'In Transit' as const,
  delivered: false,
  checkpoints: [
    {
      status: 'In Transit' as const,
      description: 'Departed facility',
      location: 'Dallas, TX',
      occurredAt: '20260930 083000',
    },
  ],
  fetchedAt: '2026-09-30T12:00:00.000Z',
};

const deliveredTracking = {
  ...inTransitTracking,
  status: 'Delivered' as const,
  delivered: true,
  checkpoints: [
    {
      status: 'Delivered' as const,
      description: 'Delivered, Front Door',
      location: 'Austin, TX',
      occurredAt: '20260930 101500',
    },
  ],
};

type FixtureTracking = typeof inTransitTracking | typeof deliveredTracking;

function evidenceFor(tracking: FixtureTracking) {
  return {
    type: 'shipping_tracking_evidence' as const,
    version: 1 as const,
    generatedAt: '2026-09-30T12:00:00.000Z',
    carrier: tracking.carrier,
    trackingNumber: tracking.trackingNumber,
    deliveryStatus: tracking.status,
    delivered: tracking.delivered,
    expeditedDismissalEligible: tracking.delivered,
    checkpoints: tracking.checkpoints,
    summary: `${tracking.carrier} reports shipment ${tracking.trackingNumber} as ${tracking.status}.`,
  };
}

function mockFetch(tracking: FixtureTracking, trackStatus = 200) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/shipping/track')) {
      if (trackStatus !== 200) {
        return new Response(JSON.stringify({ error: 'Carrier unavailable' }), {
          status: trackStatus,
        });
      }
      return new Response(JSON.stringify({ tracking, evidence: evidenceFor(tracking) }), {
        status: 200,
      });
    }
    if (url.includes('/evidence') && init?.method === 'POST') {
      return new Response(JSON.stringify({ cid: 'bafy-test' }), { status: 201 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('TrackingEvidenceCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches tracking and renders the live status and checkpoints', async () => {
    global.fetch = mockFetch(inTransitTracking);
    render(<TrackingEvidenceCard disputeId="d1" />);

    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z' } });
    fireEvent.click(screen.getByText('Fetch tracking'));

    await waitFor(() =>
      expect(screen.getByTestId('tracking-status')).toHaveTextContent('In Transit'),
    );
    expect(screen.getByTestId('tracking-checkpoint')).toHaveTextContent('Departed facility');
    expect(screen.queryByTestId('tracking-delivered-banner')).toBeNull();
  });

  it('flags a delivered package for expedited dismissal and attaches the evidence', async () => {
    const onEvidenceCompiled = vi.fn();
    global.fetch = mockFetch(deliveredTracking);
    render(<TrackingEvidenceCard disputeId="d1" onEvidenceCompiled={onEvidenceCompiled} />);

    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z' } });
    fireEvent.click(screen.getByText('Fetch tracking'));

    await waitFor(() =>
      expect(screen.getByTestId('tracking-delivered-banner')).toHaveTextContent('expedited'),
    );

    fireEvent.click(screen.getByText('Attach as evidence'));

    await waitFor(() => expect(onEvidenceCompiled).toHaveBeenCalledTimes(1));
    expect(onEvidenceCompiled).toHaveBeenCalledWith(evidenceFor(deliveredTracking));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/disputes/d1/evidence',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('Evidence attached')).toBeInTheDocument();
  });

  it('surfaces carrier lookup errors', async () => {
    global.fetch = mockFetch(inTransitTracking, 502);
    render(<TrackingEvidenceCard disputeId="d1" />);

    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z' } });
    fireEvent.click(screen.getByText('Fetch tracking'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Carrier unavailable'));
    expect(screen.queryByTestId('tracking-result')).toBeNull();
  });

  it('requires a tracking number before looking up', () => {
    global.fetch = mockFetch(inTransitTracking);
    render(<TrackingEvidenceCard disputeId="d1" />);

    fireEvent.click(screen.getByText('Fetch tracking'));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a tracking number');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
