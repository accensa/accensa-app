import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import FunnelChart from '../../../../components/analytics/FunnelChart';
import {
  compareRanges,
  monthRanges,
  segmentFunnel,
  type CheckoutEvent,
  type DeviceType,
  type FunnelStepKey,
} from '../../../lib/funnel';

const STEP_KEYS: FunnelStepKey[] = [
  'checkout_opened',
  'wallet_connected',
  'authorization_approved',
  'payment_settled',
];
const WALLETS = ['freighter', 'lobstr', 'xbull'];
const DEVICES: DeviceType[] = ['desktop', 'mobile'];

/**
 * Deterministic sample telemetry (like the cohorts page's mock data) until the
 * indexer exposes a checkout-events endpoint; `aggregateFunnel` takes the same
 * `CheckoutEvent[]` shape that endpoint will return.
 */
function sampleEvents(now: number): CheckoutEvent[] {
  const { current, prior } = monthRanges(now);
  const events: CheckoutEvent[] = [];
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  // Probability of advancing past each step, by device (mobile converts worse).
  const advance: Record<DeviceType, number[]> = {
    desktop: [0.82, 0.74, 0.9],
    mobile: [0.62, 0.55, 0.85],
  };
  for (const [range, boost, count] of [
    [current, 1.05, 600],
    [prior, 1, 560],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const device = DEVICES[rand() < 0.55 ? 1 : 0];
      const wallet = WALLETS[Math.floor(rand() * WALLETS.length)];
      const ts = range.from + Math.floor(rand() * (range.to - range.from));
      let depth = 1;
      while (depth < 4 && rand() < Math.min(0.99, advance[device][depth - 1] * boost)) depth++;
      for (let s = 0; s < depth; s++) {
        events.push({ sessionId: `${range.from}-${i}`, step: STEP_KEYS[s], ts, device, wallet });
      }
    }
  }
  return events;
}

const pct = (n: number) => `${n.toFixed(1)}%`;

export default function FunnelAnalytics() {
  const [device, setDevice] = useState<DeviceType | ''>('');
  const [wallet, setWallet] = useState('');
  // Fixed at mount so the sample data and the month boundaries agree.
  const [now] = useState(() => Date.now());
  const events = useMemo(() => sampleEvents(now), [now]);
  const { current, prior } = useMemo(() => monthRanges(now), [now]);

  const filters = { device: device || undefined, wallet: wallet || undefined };
  const comparison = useMemo(
    () => compareRanges(events, current, prior, filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, current, prior, device, wallet],
  );
  const byDevice = segmentFunnel(events, 'device', { range: current, wallet: filters.wallet });
  const byWallet = segmentFunnel(events, 'wallet', { range: current, device: filters.device });
  const { bottleneck, overallConversion } = comparison.current;
  const overallDelta = overallConversion - comparison.prior.overallConversion;

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <Head>
        <title>Conversion Funnel - Analytics</title>
      </Head>
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold text-gray-900">Conversion Funnel</h1>
          <p className="text-gray-500 mt-1">
            Where customers drop off between opening checkout and settling payment.
          </p>
        </header>

        <div className="flex flex-wrap gap-4">
          <label className="text-sm text-gray-700">
            Device
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value as DeviceType | '')}
              className="ml-2 border rounded px-2 py-1"
            >
              <option value="">All</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Wallet
            <select
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              className="ml-2 border rounded px-2 py-1"
            >
              <option value="">All</option>
              {WALLETS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded shadow-sm border border-gray-100">
            <div className="text-sm text-gray-500 uppercase tracking-wide">Overall conversion</div>
            <div className="text-3xl font-semibold mt-2">{pct(overallConversion)}</div>
            <div
              className={`text-sm mt-1 ${overallDelta >= 0 ? 'text-emerald-700' : 'text-red-600'}`}
            >
              {overallDelta >= 0 ? '+' : '−'}
              {Math.abs(overallDelta).toFixed(1)} pts vs prior month
            </div>
          </div>
          <div className="bg-white p-6 rounded shadow-sm border border-gray-100 md:col-span-2">
            <div className="text-sm text-gray-500 uppercase tracking-wide">Biggest bottleneck</div>
            <div className="text-xl font-semibold mt-2">
              {bottleneck
                ? `${pct(bottleneck.dropOff)} of customers are lost before “${bottleneck.label}”`
                : 'No drop-off in this selection'}
            </div>
          </div>
        </div>

        <section>
          <h2 className="text-xl font-semibold mb-4">This month</h2>
          <FunnelChart funnel={comparison.current} title="Current month funnel" />
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Current vs prior month</h2>
          <div className="overflow-x-auto border rounded bg-white shadow-sm">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2">Step</th>
                  <th className="px-4 py-2">Current</th>
                  <th className="px-4 py-2">Prior</th>
                  <th className="px-4 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparison.current.steps.map((s, i) => (
                  <tr key={s.key} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{s.label}</td>
                    <td className="px-4 py-2">{pct(s.conversionFromStart)}</td>
                    <td className="px-4 py-2">
                      {pct(comparison.prior.steps[i].conversionFromStart)}
                    </td>
                    <td
                      className={`px-4 py-2 ${comparison.deltaPoints[i] >= 0 ? 'text-emerald-700' : 'text-red-600'}`}
                    >
                      {comparison.deltaPoints[i] >= 0 ? '+' : '−'}
                      {Math.abs(comparison.deltaPoints[i]).toFixed(1)} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-8">
          {(
            [
              ['By device', byDevice],
              ['By wallet provider', byWallet],
            ] as const
          ).map(([heading, segments]) => (
            <section key={heading}>
              <h2 className="text-xl font-semibold mb-4">{heading}</h2>
              <div className="overflow-x-auto border rounded bg-white shadow-sm">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-4 py-2">Segment</th>
                      <th className="px-4 py-2">Sessions</th>
                      <th className="px-4 py-2">Converted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((s) => (
                      <tr key={s.label} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium capitalize">{s.label}</td>
                        <td className="px-4 py-2">{s.funnel.steps[0].count}</td>
                        <td className="px-4 py-2">{pct(s.funnel.overallConversion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
