/**
 * Shipping carrier tracking adapter (#418).
 *
 * Normalises the tracking APIs of USPS, FedEx, DHL, and UPS into a single
 * {@link TrackingResult} shape so a contested dispute can attach a standardised
 * proof-of-delivery evidence document. All network access goes through an
 * injectable `fetch`, and credentials are read lazily from the environment, so
 * the module is safe to unit test with mock carrier payloads and never requires
 * a live carrier account.
 */

export const SHIPPING_CARRIERS = ['USPS', 'FedEx', 'DHL', 'UPS'] as const;
export type ShippingCarrier = (typeof SHIPPING_CARRIERS)[number];

/** The small set of states a dispute actually cares about. */
export const TRACKING_STATUSES = [
  'Pre-Transit',
  'In Transit',
  'Delivered',
  'Exception',
  'Unknown',
] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export interface TrackingCheckpoint {
  status: TrackingStatus;
  description: string;
  location?: string;
  occurredAt?: string;
}

export interface TrackingResult {
  carrier: ShippingCarrier;
  trackingNumber: string;
  status: TrackingStatus;
  delivered: boolean;
  estimatedDelivery?: string;
  checkpoints: TrackingCheckpoint[];
  fetchedAt: string;
}

export interface TrackingEvidenceDocument {
  type: 'shipping_tracking_evidence';
  version: 1;
  generatedAt: string;
  carrier: ShippingCarrier;
  trackingNumber: string;
  deliveryStatus: TrackingStatus;
  delivered: boolean;
  /** Packages confirmed as Delivered can be dismissed without manual review. */
  expeditedDismissalEligible: boolean;
  estimatedDelivery?: string;
  checkpoints: TrackingCheckpoint[];
  summary: string;
}

export class ShippingTrackingError extends Error {
  constructor(
    message: string,
    readonly carrier?: ShippingCarrier,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ShippingTrackingError';
  }
}

type Env = Record<string, string | undefined>;

interface CarrierAdapter {
  /** Builds the request against the carrier API, reading credentials lazily. */
  buildRequest(trackingNumber: string, env: Env): { url: string; init: RequestInit };
  /** Maps a carrier payload onto the fields shared by every result. */
  parse(payload: unknown): Omit<TrackingResult, 'carrier' | 'trackingNumber' | 'fetchedAt'>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Carriers are inconsistent: some nest singletons in arrays, some do not. */
function firstRecord(value: unknown): Record<string, unknown> | null {
  return asRecord(Array.isArray(value) ? value[0] : value);
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function joinLocation(...parts: Array<string | undefined>): string | undefined {
  const joined = parts.filter(Boolean).join(', ');
  return joined || undefined;
}

/** Maps free-form carrier status text onto the four dispute-relevant states. */
export function normalizeTrackingStatus(text: string | undefined): TrackingStatus {
  const value = (text ?? '').toLowerCase();
  if (!value) return 'Unknown';
  // Exception phrases win because "delivery exception" also contains "deliver".
  if (
    value.includes('exception') ||
    value.includes('alert') ||
    value.includes('failure') ||
    value.includes('failed') ||
    value.includes('return') ||
    value.includes('refused') ||
    value.includes('held') ||
    value.includes('customs') ||
    value.includes('delay')
  ) {
    return 'Exception';
  }
  // Pre-transit must be checked before transit ("pre-transit" contains "transit").
  if (
    value.includes('pre-shipment') ||
    value.includes('pre_transit') ||
    value.includes('pre-transit') ||
    value.includes('label') ||
    value.includes('manifest') ||
    value.includes('not yet') ||
    value.includes('information received')
  ) {
    return 'Pre-Transit';
  }
  if (
    value.includes('transit') ||
    value.includes('out for delivery') ||
    value.includes('out-for-delivery') ||
    value.includes('accepted') ||
    value.includes('picked') ||
    value.includes('departed') ||
    value.includes('arrived') ||
    value.includes('processed') ||
    value.includes('in progress')
  ) {
    return 'In Transit';
  }
  if (value.includes('delivered')) return 'Delivered';
  return 'Unknown';
}

function checkpoint(
  status: TrackingStatus,
  description: string,
  occurredAt?: string,
  location?: string,
): TrackingCheckpoint {
  return {
    status,
    description,
    ...(occurredAt ? { occurredAt } : {}),
    ...(location ? { location } : {}),
  };
}

function requireCredential(env: Env, key: string, carrier: ShippingCarrier): string {
  const value = env[key];
  if (!value) {
    throw new ShippingTrackingError(
      `${carrier} tracking is not configured (missing ${key})`,
      carrier,
    );
  }
  return value;
}

function bearer(env: Env, key: string, carrier: ShippingCarrier): RequestInit {
  const token = requireCredential(env, key, carrier);
  return { headers: { accept: 'application/json', authorization: `Bearer ${token}` } };
}

function parseUsps(payload: unknown) {
  const root = asRecord(payload);
  const events = asArray(root?.trackingEvents ?? root?.events);
  const checkpoints = events.map((event) => {
    const record = asRecord(event);
    const description =
      stringField(record, 'eventDescription') ?? stringField(record, 'eventType') ?? 'Update';
    const dateTime =
      stringField(record, 'eventTimestamp') ??
      [stringField(record, 'eventDate'), stringField(record, 'eventTime')]
        .filter(Boolean)
        .join(' ');
    return checkpoint(
      normalizeTrackingStatus(stringField(record, 'eventType') ?? description),
      description,
      dateTime || undefined,
      joinLocation(stringField(record, 'eventCity'), stringField(record, 'eventState')),
    );
  });
  const status = normalizeTrackingStatus(
    stringField(root, 'statusCategory') ?? stringField(root, 'statusSummary'),
  );
  return {
    status,
    delivered: status === 'Delivered',
    estimatedDelivery: stringField(root, 'expectedDeliveryDate'),
    checkpoints,
  };
}

function parseUps(payload: unknown) {
  const shipment = firstRecord(asRecord(asRecord(payload)?.trackResponse)?.shipment);
  const pkg = firstRecord(shipment?.package);
  const activity = asArray(pkg?.activity);
  const checkpoints = activity.map((event) => {
    const record = asRecord(event);
    const statusRecord = asRecord(record?.status);
    const description = stringField(statusRecord, 'description') ?? 'Update';
    const address = asRecord(asRecord(record?.location)?.address);
    const date = stringField(record, 'date');
    const time = stringField(record, 'time');
    return checkpoint(
      normalizeTrackingStatus(
        stringField(statusRecord, 'description') ?? stringField(statusRecord, 'type'),
      ),
      description,
      date && time ? `${date} ${time}` : date,
      joinLocation(stringField(address, 'city'), stringField(address, 'stateProvince')),
    );
  });
  const currentStatus = asRecord(pkg?.currentStatus) ?? asRecord(shipment?.currentStatus);
  const status = normalizeTrackingStatus(
    stringField(currentStatus, 'description') ?? checkpoints[0]?.status,
  );
  const deliveryDates = asArray(pkg?.deliveryDate ?? shipment?.deliveryDate);
  const estimatedDelivery = stringField(asRecord(deliveryDates[0]), 'date');
  return { status, delivered: status === 'Delivered', estimatedDelivery, checkpoints };
}

function parseFedex(payload: unknown) {
  const root = asRecord(payload);
  const trackResult = firstRecord(
    firstRecord(asRecord(root?.output)?.completeTrackResults)?.trackResults,
  );
  const events = asArray(trackResult?.events);
  const checkpoints = events.map((event) => {
    const record = asRecord(event);
    const description = stringField(record, 'eventDescription') ?? 'Update';
    const address = asRecord(record?.address);
    return checkpoint(
      normalizeTrackingStatus(description),
      description,
      stringField(record, 'date'),
      joinLocation(stringField(address, 'city'), stringField(address, 'stateOrProvinceCode')),
    );
  });
  const latest = asRecord(trackResult?.latestStatusDetail);
  const status = normalizeTrackingStatus(
    stringField(latest, 'description') ?? stringField(latest, 'code') ?? checkpoints[0]?.status,
  );
  const delivery = asArray(trackResult?.dateAndTimes).find(
    (entry) => stringField(asRecord(entry), 'type') === 'ACTUAL_DELIVERY',
  );
  return {
    status,
    delivered: status === 'Delivered',
    estimatedDelivery: stringField(asRecord(delivery), 'dateTime'),
    checkpoints,
  };
}

function parseDhl(payload: unknown) {
  const shipment = firstRecord(asRecord(payload)?.shipments);
  const events = asArray(shipment?.events);
  const checkpoints = events.map((event) => {
    const record = asRecord(event);
    const description =
      stringField(record, 'description') ?? stringField(record, 'status') ?? 'Update';
    const address = asRecord(asRecord(record?.location)?.address);
    return checkpoint(
      normalizeTrackingStatus(stringField(record, 'statusCode') ?? description),
      description,
      stringField(record, 'timestamp'),
      stringField(address, 'addressLocality'),
    );
  });
  const statusRecord = asRecord(shipment?.status);
  const status = normalizeTrackingStatus(
    stringField(statusRecord, 'statusCode') ??
      stringField(statusRecord, 'description') ??
      checkpoints[0]?.status,
  );
  return {
    status,
    delivered: status === 'Delivered',
    estimatedDelivery: stringField(shipment, 'estimatedTimeOfDelivery'),
    checkpoints,
  };
}

const CARRIER_ADAPTERS: Record<ShippingCarrier, CarrierAdapter> = {
  USPS: {
    buildRequest(trackingNumber, env) {
      const token = requireCredential(env, 'USPS_ACCESS_TOKEN', 'USPS');
      return {
        url: `https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}?expand=DETAIL`,
        init: { headers: { accept: 'application/json', authorization: `Bearer ${token}` } },
      };
    },
    parse: parseUsps,
  },
  UPS: {
    buildRequest(trackingNumber, env) {
      return {
        url: `https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
        init: bearer(env, 'UPS_ACCESS_TOKEN', 'UPS'),
      };
    },
    parse: parseUps,
  },
  FedEx: {
    buildRequest(trackingNumber, env) {
      return {
        url: 'https://apis.fedex.com/track/v1/trackingnumbers',
        init: {
          ...bearer(env, 'FEDEX_ACCESS_TOKEN', 'FedEx'),
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${requireCredential(env, 'FEDEX_ACCESS_TOKEN', 'FedEx')}`,
          },
          body: JSON.stringify({ trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
        },
      };
    },
    parse: parseFedex,
  },
  DHL: {
    buildRequest(trackingNumber, env) {
      const key = requireCredential(env, 'DHL_API_KEY', 'DHL');
      return {
        url: `https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`,
        init: { headers: { accept: 'application/json', 'DHL-API-Key': key } },
      };
    },
    parse: parseDhl,
  },
};

/** Case-insensitively resolves a carrier label to a supported carrier. */
export function normalizeCarrier(value: string): ShippingCarrier | null {
  const match = SHIPPING_CARRIERS.find(
    (carrier) => carrier.toLowerCase() === value.trim().toLowerCase(),
  );
  return match ?? null;
}

export interface FetchTrackingOptions {
  carrier: ShippingCarrier;
  trackingNumber: string;
  fetchImpl?: typeof fetch;
  env?: Env;
  now?: number;
}

/** Fetches and normalises real-time tracking checkpoints for one shipment. */
export async function fetchTracking({
  carrier,
  trackingNumber,
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = Date.now(),
}: FetchTrackingOptions): Promise<TrackingResult> {
  const normalizedTrackingNumber = trackingNumber.trim();
  if (!normalizedTrackingNumber) {
    throw new ShippingTrackingError('A tracking number is required', carrier);
  }

  const adapter = CARRIER_ADAPTERS[carrier];
  const { url, init } = adapter.buildRequest(normalizedTrackingNumber, env);
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new ShippingTrackingError(
      `${carrier} tracking lookup failed with status ${response.status}`,
      carrier,
      response.status,
    );
  }

  const payload = await response.json();
  const parsed = adapter.parse(payload);
  return {
    carrier,
    trackingNumber: normalizedTrackingNumber,
    fetchedAt: new Date(now).toISOString(),
    ...parsed,
  };
}

/** A confirmed delivery qualifies the dispute for expedited dismissal. */
export function isExpeditedDismissalEligible(
  result: Pick<TrackingResult, 'status' | 'delivered'>,
): boolean {
  return result.delivered || result.status === 'Delivered';
}

/** Formats a tracking result into the standard evidence document for a dispute. */
export function buildTrackingEvidenceDocument(result: TrackingResult): TrackingEvidenceDocument {
  const expedited = isExpeditedDismissalEligible(result);
  const summary = expedited
    ? `${result.carrier} confirms shipment ${result.trackingNumber} was delivered. Expedited dispute dismissal requested.`
    : `${result.carrier} reports shipment ${result.trackingNumber} as ${result.status}.`;
  return {
    type: 'shipping_tracking_evidence',
    version: 1,
    generatedAt: new Date().toISOString(),
    carrier: result.carrier,
    trackingNumber: result.trackingNumber,
    deliveryStatus: result.status,
    delivered: result.delivered,
    expeditedDismissalEligible: expedited,
    ...(result.estimatedDelivery ? { estimatedDelivery: result.estimatedDelivery } : {}),
    checkpoints: result.checkpoints,
    summary,
  };
}
