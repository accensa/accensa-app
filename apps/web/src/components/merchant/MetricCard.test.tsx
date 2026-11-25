// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCard } from './MetricCard';

describe('MetricCard', () => {
  it('replaces string and numeric values with the pulse placeholder when loading', () => {
    const { container, rerender } = render(
      <MetricCard title="Revenue" value="12.50 USDC" loading />,
    );

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByText('12.50 USDC')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    rerender(<MetricCard title="Revenue" value={42} loading />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows string and numeric values when not loading', () => {
    const { rerender } = render(<MetricCard title="Revenue" value="12.50 USDC" />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('12.50 USDC')).toBeInTheDocument();

    rerender(<MetricCard title="Revenue" value={42} />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('uses the up glyph for a positive trend when isPositive is true', () => {
    render(<MetricCard title="Revenue" value={42} trend={{ value: 4, isPositive: true }} />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('↑ 4%')).toBeInTheDocument();
    expect(screen.getByText('vs last period')).toBeInTheDocument();
  });

  it('uses the down glyph with an absolute percentage when isPositive is false, even for a negative value', () => {
    render(<MetricCard title="Revenue" value={42} trend={{ value: -4, isPositive: false }} />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('↓ 4%')).toBeInTheDocument();
    expect(screen.queryByText('↓ -4%')).not.toBeInTheDocument();
  });

  it('omits the subtitle and trend rows when they are not supplied', () => {
    render(<MetricCard title="Revenue" value={42} />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.queryByText('Compared with last week')).not.toBeInTheDocument();
    expect(screen.queryByText('vs last period')).not.toBeInTheDocument();
  });

  it('shows the subtitle when supplied', () => {
    render(<MetricCard title="Revenue" value={42} subtitle="Compared with last week" />);

    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Compared with last week')).toBeInTheDocument();
  });
});
