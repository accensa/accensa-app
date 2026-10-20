// @vitest-environment jsdom

import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QrCountdown } from './QrCountdown';

const startTime = new Date('2026-01-01T00:00:00.000Z').getTime();

describe('QrCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startTime);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders initial MM:SS with zero padding for single-digit seconds', () => {
    const expiresAt = new Date(startTime + 75000); // 1 minute 15 seconds
    render(<QrCountdown expiresAt={expiresAt} />);

    expect(screen.getByText('Expires in')).toBeInTheDocument();
    expect(screen.getByText('01:15')).toBeInTheDocument();
  });

  it('pads single-digit minutes and seconds correctly', () => {
    const expiresAt = new Date(startTime + 7000); // 7 seconds
    render(<QrCountdown expiresAt={expiresAt} />);

    expect(screen.getByText('00:07')).toBeInTheDocument();
  });

  it('does not trigger warning styling when remaining is above warningThreshold', () => {
    const expiresAt = new Date(startTime + 35000); // 35 seconds, default warningThreshold = 30
    const { container } = render(<QrCountdown expiresAt={expiresAt} warningThreshold={30} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).not.toHaveClass('animate-pulse');
    expect(screen.getByText('00:35')).toBeInTheDocument();
  });

  it('sets warning styling strictly inside (0, warningThreshold]', () => {
    const expiresAt = new Date(startTime + 30000); // exactly 30 seconds
    const { container } = render(<QrCountdown expiresAt={expiresAt} warningThreshold={30} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('animate-pulse');
    expect(screen.getByText('00:30')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(wrapper).toHaveClass('animate-pulse');
    expect(screen.getByText('00:29')).toBeInTheDocument();
  });

  it('replaces timer with Expired block at exactly zero and does not treat zero as warning', () => {
    const expiresAt = new Date(startTime + 2000);
    const { container } = render(<QrCountdown expiresAt={expiresAt} warningThreshold={30} />);

    expect(screen.getByText('00:02')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(container.firstChild).not.toHaveClass('animate-pulse');
    expect(screen.queryByText('Expires in')).not.toBeInTheDocument();
  });

  it('asserts actual behavior of onExpire: fires on every tick after zero (repeat-fire finding)', () => {
    const onExpire = vi.fn();
    const expiresAt = new Date(startTime + 1000);
    render(<QrCountdown expiresAt={expiresAt} onExpire={onExpire} />);

    expect(onExpire).not.toHaveBeenCalled();

    // Advance to t = 1s (expires)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    // Advance past zero (t = 2s, 3s) confirming interval continues to fire onExpire
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(3);
  });

  it('tears down interval on unmount so no updates occur post-unmount', () => {
    const onExpire = vi.fn();
    const expiresAt = new Date(startTime + 5000);
    const { unmount } = render(<QrCountdown expiresAt={expiresAt} onExpire={onExpire} />);

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onExpire).not.toHaveBeenCalled();
  });
});
