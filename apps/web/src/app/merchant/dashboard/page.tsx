'use client';

import React, { useState, useCallback } from 'react';
import { MetricCard } from '@/components/merchant/MetricCard';
import { VolumeChart } from '@/components/merchant/VolumeChart';
import { useMerchantTelemetry } from '@/hooks/useMerchantTelemetry';
import { useOnline } from '@/components/network-status';
import { ArrowUpRight, TrendingUp, Shield, Zap } from 'lucide-react';
import { formatAmount, assetLabel } from '@/lib/money';
import useSWR from 'swr';

interface DashboardMetrics {
  totalSettledVolume: string;
  activeAuthorizations: number;
  disputeRate: number;
  gasFeesReclaimed: string;
}

interface VolumeData {
  time: string;
  volume: number;
}

type TimeRange = '24h' | '7d' | '30d' | 'custom';

async function fetchMetrics(url: string): Promise<DashboardMetrics> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

async function fetchVolumeData(url: string): Promise<VolumeData[]> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export default function MerchantDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const online = useOnline();
  const telemetry = useMerchantTelemetry('current-merchant'); // TODO: Get from auth context

  const { data: metrics, error: metricsError } = useSWR<DashboardMetrics>(
    online ? '/api/merchant/metrics' : null,
    fetchMetrics,
    { refreshInterval: 15000 }
  );

  const { data: volumeData, error: volumeError } = useSWR<VolumeData[]>(
    online ? `/api/merchant/volume?range=${timeRange}` : null,
    fetchVolumeData,
    { refreshInterval: 30000 }
  );

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  return (
    <main className="min-h-screen text-slate-600 dark:text-slate-200 font-sans selection:bg-slate-200 dark:selection:bg-white/10 transition-colors duration-300 bg-grid p-6 md:p-12 lg:p-20 pt-28 md:pt-32 lg:pt-32">
      <div className="space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400 font-bold text-xs mb-3">
              Merchant Dashboard
            </p>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tighter text-slate-900 dark:text-white transition-colors duration-300">
              Live Telemetry
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white/40 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full">
              <div
                className={`w-2 h-2 rounded-full ${
                  telemetry.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                }`}
              />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {telemetry.isConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            {telemetry.lastUpdate && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Last update: {telemetry.lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </header>

        {/* Time Range Filter */}
        <div className="flex flex-wrap gap-2">
          {(['24h', '7d', '30d'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => handleTimeRangeChange(range)}
              className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-lg transition-colors ${
                timeRange === range
                  ? 'bg-emerald-600 dark:bg-emerald-500 text-white dark:text-black'
                  : 'bg-white/40 dark:bg-white/5 text-slate-700 dark:text-white hover:bg-white/60 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Total Settled Volume"
            value={metrics ? formatAmount(metrics.totalSettledVolume) : '-'}
            subtitle="USD/XLM"
            icon={<TrendingUp className="w-5 h-5" />}
            loading={!metrics}
            trend={{ value: 12.5, isPositive: true }}
          />
          <MetricCard
            title="Active Authorizations"
            value={metrics?.activeAuthorizations ?? '-'}
            icon={<Shield className="w-5 h-5" />}
            loading={!metrics}
            trend={{ value: 8.2, isPositive: true }}
          />
          <MetricCard
            title="Dispute Rate"
            value={metrics ? `${metrics.disputeRate}%` : '-'}
            icon={<ArrowUpRight className="w-5 h-5" />}
            loading={!metrics}
            trend={{ value: 2.1, isPositive: false }}
          />
          <MetricCard
            title="Gas Fees Reclaimed"
            value={metrics ? formatAmount(metrics.gasFeesReclaimed) : '-'}
            subtitle="XLM"
            icon={<Zap className="w-5 h-5" />}
            loading={!metrics}
            trend={{ value: 15.3, isPositive: true }}
          />
        </div>

        {/* Volume Chart */}
        <VolumeChart
          data={volumeData ?? []}
          loading={!volumeData}
          timeRange={timeRange === 'custom' ? '24h' : timeRange}
        />

        {/* Recent Transactions Alert */}
        {telemetry.recentPayments.length > 0 && (
          <div className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
            <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white mb-4 transition-colors duration-300">
              Recent Incoming Payments
            </h3>
            <div className="space-y-3">
              {telemetry.recentPayments.slice(0, 5).map((payment) => (
                <div
                  key={payment.tx_hash}
                  className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white text-sm">
                        {formatAmount(payment.amount)} {assetLabel(payment.asset)}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {payment.route || 'Unknown route'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(payment.ts).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
