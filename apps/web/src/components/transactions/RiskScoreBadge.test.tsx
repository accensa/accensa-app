// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskScoreBadge } from './RiskScoreBadge';

describe('RiskScoreBadge', () => {
  it('clamps a negative score to 0', () => {
    render(<RiskScoreBadge score={-5} />);
    expect(screen.getByText('0')).toBeDefined();
  });

  it('clamps a score above 100 to 100', () => {
    render(<RiskScoreBadge score={105} />);
    expect(screen.getByText('100')).toBeDefined();
  });

  it('passes through exact boundary scores unchanged', () => {
    render(<RiskScoreBadge score={0} />);
    expect(screen.getByText('0')).toBeDefined();
  });

  it('rounds a non-integer score', () => {
    render(<RiskScoreBadge score={72.6} />);
    expect(screen.getByText('73')).toBeDefined();
  });

  it('uses the high tone at the 75 boundary but not at 74', () => {
    const { rerender } = render(<RiskScoreBadge score={74} />);
    expect(screen.getByText('74').parentElement?.className).not.toContain('border-red-300');

    rerender(<RiskScoreBadge score={75} />);
    expect(screen.getByText('75').parentElement?.className).toContain('border-red-300');
  });

  it('uses the mid tone at the 40 boundary but not at 39', () => {
    const { rerender } = render(<RiskScoreBadge score={39} />);
    expect(screen.getByText('39').parentElement?.className).toContain('border-emerald-300');

    rerender(<RiskScoreBadge score={40} />);
    expect(screen.getByText('40').parentElement?.className).toContain('border-amber-300');
  });

  it('renders no flag for an absent country code', () => {
    render(<RiskScoreBadge score={50} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders no flag and does not throw for an invalid country code', () => {
    expect(() => render(<RiskScoreBadge score={50} countryCode="123" />)).not.toThrow();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a flag for a valid country code', () => {
    render(<RiskScoreBadge score={50} countryCode="us" />);
    expect(screen.getByRole('img', { name: 'Country us' })).toBeDefined();
  });

  it('changes the title when requiresManualReview is true', () => {
    const { rerender } = render(<RiskScoreBadge score={50} />);
    expect(screen.getByText('50').parentElement?.getAttribute('title')).toBe(
      'Risk score 50 of 100',
    );

    rerender(<RiskScoreBadge score={50} requiresManualReview />);
    expect(screen.getByText('50').parentElement?.getAttribute('title')).toBe(
      'Requires manual review',
    );
  });
});
