import { NextResponse } from 'next/server';
import {
  buildTrackingEvidenceDocument,
  fetchTracking,
  normalizeCarrier,
  ShippingTrackingError,
} from '../../../../../lib/shipping/trackingAdapter';

export const dynamic = 'force-dynamic';

/**
 * Server-side proxy for carrier tracking lookups (#418). Carrier credentials
 * stay on the server; the dispute UI only ever sees the normalised result and
 * the evidence document it can attach.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const carrier = normalizeCarrier(searchParams.get('carrier') ?? '');
  const trackingNumber = searchParams.get('trackingNumber')?.trim() ?? '';

  if (!carrier) {
    return NextResponse.json(
      { error: 'carrier must be one of USPS, FedEx, DHL, or UPS' },
      { status: 400 },
    );
  }
  if (!trackingNumber) {
    return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
  }

  try {
    const tracking = await fetchTracking({ carrier, trackingNumber });
    return NextResponse.json(
      { tracking, evidence: buildTrackingEvidenceDocument(tracking) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ShippingTrackingError && error.status ? 502 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tracking lookup failed' },
      { status },
    );
  }
}
