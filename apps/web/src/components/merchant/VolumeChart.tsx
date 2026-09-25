'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface VolumeChartProps {
  data: Array<{
    time: string;
    volume: number;
  }>;
  loading?: boolean;
  timeRange?: '24h' | '7d' | '30d';
}

export function VolumeChart({ data, loading = false, timeRange = '24h' }: VolumeChartProps) {
  if (loading) {
    return (
      <div className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
        <div className="h-64 bg-slate-200 dark:bg-white/10 animate-pulse rounded" />
      </div>
    );
  }

  const formatTooltip = (value: number | undefined) => {
    if (value === undefined) return '';
    return `$${value.toLocaleString()}`;
  };

  const formatXAxis = (tick: string | undefined) => {
    if (!tick) return '';
    if (timeRange === '24h') {
      return new Date(tick).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    return new Date(tick).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-white/90 dark:bg-[#0c131d]/90 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.12),inset_0_1px_1px_rgba(255,255,255,0.8)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.15)] transition-colors duration-300">
      <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white mb-6 transition-colors duration-300">
        Payment Volume
      </h3>
      <ResponsiveContainer width="100%" height={256}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            strokeWidth={0.5}
            className="stroke-slate-200 dark:stroke-white/10"
          />
          <XAxis
            dataKey="time"
            tickFormatter={formatXAxis}
            className="text-xs text-slate-600 dark:text-slate-400"
            stroke="currentColor"
            strokeWidth={0.5}
          />
          <YAxis
            tickFormatter={formatTooltip}
            className="text-xs text-slate-600 dark:text-slate-400"
            stroke="currentColor"
            strokeWidth={0.5}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '8px',
            }}
            itemStyle={{ color: '#0f172a' }}
            labelStyle={{ color: '#64748b' }}
            formatter={(value) => [formatTooltip(value as number), 'Volume']}
            labelFormatter={(label) => formatXAxis(label as string)}
          />
          <Line
            type="monotone"
            dataKey="volume"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#10b981' }}
          />
          <ReferenceLine
            y={data.length > 0 ? data[data.length - 1].volume : 0}
            stroke="#10b981"
            strokeDasharray="3 3"
            strokeWidth={0.5}
            strokeOpacity={0.3}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
