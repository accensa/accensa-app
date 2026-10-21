// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpsFeedbackWidget } from './NpsFeedbackWidget';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('NpsFeedbackWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing before the 1500ms entrance timer and appears after', () => {
    const { container } = render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    expect(container).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('How was your payment experience?')).toBeDefined();
  });

  it('stays hidden when the stored feedback stamp is within the last 30 days', () => {
    localStorage.setItem('accensa_last_feedback', Date.now().toString());

    const { container } = render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('shows when the stored feedback stamp is older than 30 days', () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem('accensa_last_feedback', thirtyOneDaysAgo.toString());

    render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('How was your payment experience?')).toBeDefined();
  });

  it('shows when there is no stored feedback stamp at all', () => {
    render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText('How was your payment experience?')).toBeDefined();
  });

  it('updates the rating state when a star is clicked, and a null rating cannot submit', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
    render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    const fourStars = screen.getByRole('button', { name: '4 out of 5 stars' });
    expect(fourStars.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(fourStars);
    expect(fourStars.getAttribute('aria-pressed')).toBe('true');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('submitting a rating records the stamp and auto-dismisses after 3s', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByRole('button', { name: '5 out of 5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(setItemSpy).toHaveBeenCalledWith('accensa_last_feedback', expect.any(String));
    expect(screen.getByText('Thank you!')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("reports deviceType 'mobile' for an iPhone user agent", async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
    render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByRole('button', { name: '5 out of 5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/feedback/submit',
      expect.objectContaining({
        body: expect.stringContaining('"deviceType":"mobile"'),
      }),
    );
  });

  it("reports deviceType 'desktop' for a non-mobile user agent", async () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({} as Response);
    render(<NpsFeedbackWidget transactionId="tx1" merchantId="m1" />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByRole('button', { name: '5 out of 5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/feedback/submit',
      expect.objectContaining({
        body: expect.stringContaining('"deviceType":"desktop"'),
      }),
    );
  });
});
