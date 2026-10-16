// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolumeChart } from './VolumeChart';

interface ChartChildProps {
  data?: Array<{ time?: string; volume?: number }>;
}

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data?: Array<{ time?: string; volume?: number }>;
  }) => (
    <div data-testid="line-chart">
      {React.Children.map(children, (child) =>
        React.isValidElement<ChartChildProps>(child) ? React.cloneElement(child, { data }) : child,
      )}
    </div>
  ),
  XAxis: ({
    dataKey,
    tickFormatter,
    data,
  }: {
    dataKey?: string;
    tickFormatter?: (tick: string | undefined) => string;
    data?: Array<{ time?: string; volume?: number }>;
  }) => (
    <div data-testid="x-axis">
      {data?.map((item, idx) => {
        const val = dataKey && dataKey in item ? item[dataKey as keyof typeof item] : undefined;
        const formatted = tickFormatter
          ? tickFormatter(typeof val === 'string' || val === undefined ? val : String(val))
          : String(val ?? '');
        return (
          <span key={idx} data-testid="x-axis-tick">
            {formatted}
          </span>
        );
      })}
    </div>
  ),
  YAxis: ({
    tickFormatter,
    data,
  }: {
    tickFormatter?: (val: number | undefined) => string;
    data?: Array<{ volume?: number }>;
  }) => (
    <div data-testid="y-axis">
      {data?.map((item, idx) => {
        const formatted = tickFormatter ? tickFormatter(item.volume) : String(item.volume ?? '');
        return (
          <span key={idx} data-testid="y-axis-tick">
            {formatted}
          </span>
        );
      })}
    </div>
  ),
  Tooltip: () => null,
  Line: () => null,
  CartesianGrid: () => null,
  ReferenceLine: () => null,
}));

describe('VolumeChart', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders loading placeholder while data is pending', () => {
    const { container } = render(<VolumeChart data={[]} loading={true} />);
    expect(screen.queryByText('Payment Volume')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders chart title and content when loading is false', () => {
    const { container } = render(<VolumeChart data={[]} loading={false} />);
    expect(screen.getByText('Payment Volume')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('renders undefined series values as blank rather than NaN or undefined', () => {
    const sampleData = [
      { time: '2026-03-09T10:00:00.000Z', volume: undefined as unknown as number },
    ];
    render(<VolumeChart data={sampleData} />);
    const ticks = screen.getAllByTestId('y-axis-tick');
    expect(ticks[0]).toHaveTextContent('');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('renders defined series values as formatted dollar amounts', () => {
    const sampleData = [{ time: '2026-03-09T10:00:00.000Z', volume: 12500 }];
    render(<VolumeChart data={sampleData} />);
    expect(screen.getByText('$12,500')).toBeInTheDocument();
  });

  it('skips missing tick entries by rendering them as blank strings', () => {
    const sampleData = [
      { time: '', volume: 100 },
      { time: undefined as unknown as string, volume: 200 },
    ];
    render(<VolumeChart data={sampleData} />);
    const ticks = screen.getAllByTestId('x-axis-tick');
    expect(ticks[0]).toHaveTextContent('');
    expect(ticks[1]).toHaveTextContent('');
  });

  it('formats tick labels in hour format when timeRange is 24h', () => {
    const isoTime = '2026-03-09T15:30:00.000Z';
    const expected = new Date(isoTime).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    render(<VolumeChart data={[{ time: isoTime, volume: 500 }]} timeRange="24h" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('formats tick labels in date format when timeRange is 7d or 30d', () => {
    const isoTime = '2026-03-09T15:30:00.000Z';
    const expected = new Date(isoTime).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    render(<VolumeChart data={[{ time: isoTime, volume: 500 }]} timeRange="7d" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
