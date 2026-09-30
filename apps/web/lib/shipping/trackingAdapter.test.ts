import { describe, expect, it, vi } from 'vitest';
import {
  ShippingTrackingError,
  buildTrackingEvidenceDocument,
  fetchTracking,
  isExpeditedDismissalEligible,
  normalizeCarrier,
  normalizeTrackingStatus,
} from './trackingAdapter';

const now = Date.parse('2026-09-30T12:00:00.000Z');
const env = {
  USPS_ACCESS_TOKEN: 'usps-token',
  UPS_ACCESS_TOKEN: 'ups-token',
  FEDEX_ACCESS_TOKEN: 'fedex-token',
  DHL_API_KEY: 'dhl-key',
};

function fetchJson(payload: unknown, status = 200) {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status }),
  ) as unknown as typeof fetch;
}

const uspsDelivered = {
  statusCategory: 'Delivered',
  statusSummary: 'Your item was delivered to the front door',
  expectedDeliveryDate: '2026-09-30',
  trackingEvents: [
    {
      eventType: 'Delivered',
      eventDescription: 'Delivered, Front Door/Porch',
      eventDate: 'September 30, 2026',
      eventTime: '10:15 am',
      eventCity: 'Austin',
      eventState: 'TX',
    },
  ],
};

const upsInTransit = {
  trackResponse: {
    shipment: {
      package: {
        currentStatus: { type: 'I', description: 'In Transit' },
        deliveryDate: [{ date: '20261002' }],
        activity: [
          {
            status: { type: 'I', description: 'In Transit' },
            location: { address: { city: 'Dallas', stateProvince: 'TX' } },
            date: '20260930',
            time: '083000',
          },
        ],
      },
    },
  },
};

const fedexException = {
  output: {
    completeTrackResults: [
      {
        trackResults: [
          {
            latestStatusDetail: { code: 'EX', description: 'Exception' },
            events: [
              {
                eventDescription: 'Delivery exception - recipient not available',
                date: '2026-09-30T09:00:00',
                address: { city: 'Austin', stateOrProvinceCode: 'TX' },
              },
            ],
          },
        ],
      },
    ],
  },
};

const dhlDelivered = {
  shipments: [
    {
      status: { statusCode: 'delivered', description: 'Delivered' },
      estimatedTimeOfDelivery: '2026-09-30T10:15:00',
      events: [
        {
          timestamp: '2026-09-30T10:15:00',
          statusCode: 'delivered',
          description: 'Delivered',
          location: { address: { addressLocality: 'Austin' } },
        },
      ],
    },
  ],
};

describe('fetchTracking', () => {
  it('normalises a USPS delivered response', async () => {
    const result = await fetchTracking({
      carrier: 'USPS',
      trackingNumber: ' 9400100000000000000000 ',
      fetchImpl: fetchJson(uspsDelivered),
      env,
      now,
    });

    expect(result.carrier).toBe('USPS');
    expect(result.trackingNumber).toBe('9400100000000000000000');
    expect(result.status).toBe('Delivered');
    expect(result.delivered).toBe(true);
    expect(result.fetchedAt).toBe('2026-09-30T12:00:00.000Z');
    expect(result.checkpoints).toEqual([
      {
        status: 'Delivered',
        description: 'Delivered, Front Door/Porch',
        occurredAt: 'September 30, 2026 10:15 am',
        location: 'Austin, TX',
      },
    ]);
  });

  it('normalises a UPS in-transit response', async () => {
    const result = await fetchTracking({
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      fetchImpl: fetchJson(upsInTransit),
      env,
      now,
    });

    expect(result.status).toBe('In Transit');
    expect(result.delivered).toBe(false);
    expect(result.estimatedDelivery).toBe('20261002');
    expect(result.checkpoints[0]).toMatchObject({ location: 'Dallas, TX' });
  });

  it('normalises a FedEx exception response', async () => {
    const result = await fetchTracking({
      carrier: 'FedEx',
      trackingNumber: '123456789012',
      fetchImpl: fetchJson(fedexException),
      env,
      now,
    });

    expect(result.status).toBe('Exception');
    expect(result.delivered).toBe(false);
    expect(result.checkpoints[0].description).toBe('Delivery exception - recipient not available');
  });

  it('normalises a DHL delivered response', async () => {
    const result = await fetchTracking({
      carrier: 'DHL',
      trackingNumber: 'JV1234567890',
      fetchImpl: fetchJson(dhlDelivered),
      env,
      now,
    });

    expect(result.status).toBe('Delivered');
    expect(isExpeditedDismissalEligible(result)).toBe(true);
  });

  it('sends carrier-appropriate credentials without leaking them into the URL', async () => {
    const fetchImpl = fetchJson(dhlDelivered);
    await fetchTracking({ carrier: 'DHL', trackingNumber: 'JV1', fetchImpl, env, now });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('api-eu.dhl.com');
    expect(String(url)).not.toContain('dhl-key');
    expect((init as RequestInit).headers).toMatchObject({ 'DHL-API-Key': 'dhl-key' });
  });

  it('rejects a tracking number that is blank', async () => {
    await expect(
      fetchTracking({ carrier: 'UPS', trackingNumber: '   ', fetchImpl: fetchJson({}), env, now }),
    ).rejects.toThrow(ShippingTrackingError);
  });

  it('fails with the carrier status when the carrier API is unavailable', async () => {
    await expect(
      fetchTracking({
        carrier: 'UPS',
        trackingNumber: '1Z',
        fetchImpl: fetchJson({}, 503),
        env,
        now,
      }),
    ).rejects.toMatchObject({ name: 'ShippingTrackingError', carrier: 'UPS', status: 503 });
  });

  it('fails clearly when credentials are not configured', async () => {
    await expect(
      fetchTracking({
        carrier: 'FedEx',
        trackingNumber: '123',
        fetchImpl: fetchJson(fedexException),
        env: {},
        now,
      }),
    ).rejects.toThrow(/FEDEX_ACCESS_TOKEN/);
  });
});

describe('normalizeCarrier', () => {
  it('matches carriers case-insensitively and rejects unknown ones', () => {
    expect(normalizeCarrier('fedex')).toBe('FedEx');
    expect(normalizeCarrier('DHL')).toBe('DHL');
    expect(normalizeCarrier('pigeon')).toBeNull();
  });
});

describe('normalizeTrackingStatus', () => {
  it('maps carrier text to the dispute-relevant states', () => {
    expect(normalizeTrackingStatus('Out for delivery')).toBe('In Transit');
    expect(normalizeTrackingStatus('DELIVERED')).toBe('Delivered');
    expect(normalizeTrackingStatus('Customs delay')).toBe('Exception');
    expect(normalizeTrackingStatus('Label created')).toBe('Pre-Transit');
    expect(normalizeTrackingStatus('')).toBe('Unknown');
  });
});

describe('buildTrackingEvidenceDocument', () => {
  it('produces an expedited-dismissal evidence document for a delivery', async () => {
    const tracking = await fetchTracking({
      carrier: 'USPS',
      trackingNumber: '9400',
      fetchImpl: fetchJson(uspsDelivered),
      env,
      now,
    });
    const document = buildTrackingEvidenceDocument(tracking);

    expect(document.type).toBe('shipping_tracking_evidence');
    expect(document.version).toBe(1);
    expect(document.expeditedDismissalEligible).toBe(true);
    expect(document.deliveryStatus).toBe('Delivered');
    expect(document.summary).toMatch(/delivered/i);
    expect(document.checkpoints).toHaveLength(1);
  });

  it('does not flag an in-transit shipment for expedited dismissal', async () => {
    const tracking = await fetchTracking({
      carrier: 'UPS',
      trackingNumber: '1Z',
      fetchImpl: fetchJson(upsInTransit),
      env,
      now,
    });
    const document = buildTrackingEvidenceDocument(tracking);

    expect(document.expeditedDismissalEligible).toBe(false);
    expect(document.summary).toMatch(/In Transit/);
  });
});
