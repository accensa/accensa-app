'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Package, Truck } from 'lucide-react';
import {
  SHIPPING_CARRIERS,
  type ShippingCarrier,
  type TrackingEvidenceDocument,
  type TrackingResult,
} from '../../lib/shipping/trackingAdapter';

export interface TrackingEvidenceCardProps {
  disputeId: string;
  defaultCarrier?: ShippingCarrier;
  defaultTrackingNumber?: string;
  /** Called once the compiled evidence has been accepted for the dispute. */
  onEvidenceCompiled?: (evidence: TrackingEvidenceDocument) => void;
}

interface TrackResponse {
  tracking: TrackingResult;
  evidence: TrackingEvidenceDocument;
}

const STATUS_TONES: Record<TrackingResult['status'], string> = {
  Delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'In Transit': 'border-blue-200 bg-blue-50 text-blue-700',
  Exception: 'border-red-200 bg-red-50 text-red-700',
  'Pre-Transit': 'border-amber-200 bg-amber-50 text-amber-700',
  Unknown: 'border-gray-200 bg-gray-50 text-gray-600',
};

function isTrackResponse(value: TrackResponse | { error?: string } | null): value is TrackResponse {
  return !!value && 'tracking' in value && 'evidence' in value;
}

/**
 * Lets a merchant attach live carrier tracking to a contested dispute (#418).
 * Tracking is fetched through the server route so carrier credentials never
 * reach the browser; a confirmed delivery is surfaced for expedited dismissal.
 */
export default function TrackingEvidenceCard({
  disputeId,
  defaultCarrier = 'UPS',
  defaultTrackingNumber = '',
  onEvidenceCompiled,
}: TrackingEvidenceCardProps) {
  const [carrier, setCarrier] = useState<ShippingCarrier>(defaultCarrier);
  const [trackingNumber, setTrackingNumber] = useState(defaultTrackingNumber);
  const [tracking, setTracking] = useState<TrackingResult | null>(null);
  const [evidence, setEvidence] = useState<TrackingEvidenceDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!trackingNumber.trim()) {
      setError('Enter a tracking number first.');
      return;
    }
    setLoading(true);
    setError(null);
    setAttached(false);
    try {
      const query = `carrier=${encodeURIComponent(carrier)}&trackingNumber=${encodeURIComponent(
        trackingNumber.trim(),
      )}`;
      const response = await fetch(`/api/shipping/track?${query}`);
      const body = (await response.json().catch(() => null)) as
        TrackResponse | { error?: string } | null;
      if (!response.ok || !isTrackResponse(body)) {
        const message = (body as { error?: string } | null)?.error;
        throw new Error(message ?? 'Tracking lookup failed.');
      }
      setTracking(body.tracking);
      setEvidence(body.evidence);
    } catch (lookupError) {
      setTracking(null);
      setEvidence(null);
      setError(lookupError instanceof Error ? lookupError.message : 'Tracking lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  async function attachEvidence() {
    if (!evidence) return;
    setAttaching(true);
    setError(null);
    try {
      const response = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidence }),
      });
      if (!response.ok) throw new Error('Evidence could not be submitted.');
      setAttached(true);
      onEvidenceCompiled?.(evidence);
    } catch (attachError) {
      setError(
        attachError instanceof Error ? attachError.message : 'Evidence could not be submitted.',
      );
    } finally {
      setAttaching(false);
    }
  }

  const expedited = tracking?.delivered || evidence?.expeditedDismissalEligible;

  return (
    <section
      aria-labelledby="tracking-evidence-heading"
      className="rounded-lg border border-gray-200 p-4"
      data-testid="tracking-evidence-card"
    >
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-gray-500" />
        <h2 id="tracking-evidence-heading" className="text-lg font-semibold text-gray-900">
          Shipping tracking evidence
        </h2>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Pull delivery confirmation from the carrier to counter a dispute.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Carrier
          <select
            aria-label="Carrier"
            value={carrier}
            onChange={(event) => setCarrier(event.target.value as ShippingCarrier)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          >
            {SHIPPING_CARRIERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-gray-600">
          Tracking number
          <input
            type="text"
            aria-label="Tracking number"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            placeholder="1Z999AA10123456784"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
        </label>
        <button
          type="button"
          onClick={() => void lookup()}
          disabled={loading}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Fetching…' : 'Fetch tracking'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {tracking && (
        <div className="mt-4 space-y-3" data-testid="tracking-result">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="tracking-status"
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                STATUS_TONES[tracking.status]
              }`}
            >
              <Truck className="h-3.5 w-3.5" />
              {tracking.status}
            </span>
            <span className="text-xs text-gray-500">
              {tracking.carrier} · {tracking.trackingNumber}
            </span>
          </div>

          {expedited && (
            <p
              data-testid="tracking-delivered-banner"
              className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
            >
              <CheckCircle2 className="h-4 w-4" />
              Delivered — eligible for expedited dispute dismissal.
            </p>
          )}

          <ol
            className="space-y-2 border-l-2 border-gray-200 pl-4"
            data-testid="tracking-checkpoints"
          >
            {tracking.checkpoints.length === 0 && (
              <li className="text-sm text-gray-500">No checkpoints reported yet.</li>
            )}
            {tracking.checkpoints.map((checkpoint, index) => (
              <li key={`${checkpoint.occurredAt ?? ''}-${index}`} data-testid="tracking-checkpoint">
                <p className="text-sm font-medium text-gray-900">{checkpoint.description}</p>
                <p className="text-xs text-gray-500">
                  {[checkpoint.occurredAt, checkpoint.location].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void attachEvidence()}
              disabled={attaching || attached}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {attached ? 'Evidence attached' : attaching ? 'Attaching…' : 'Attach as evidence'}
            </button>
            {expedited && !attached && (
              <span className="flex items-center gap-1 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Confirmed delivery supports an expedited dismissal request.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
