// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchFilterBar } from './SearchFilterBar';

const mockUseTransactionFilters = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useTransactionFilters', () => ({
  useTransactionFilters: mockUseTransactionFilters,
}));

function mockFilters(
  overrides: Partial<Record<'search' | 'status' | 'asset' | 'dateRange', string>> = {},
) {
  const updateFilters = vi.fn();
  const clearFilters = vi.fn();
  mockUseTransactionFilters.mockReturnValue({
    filters: { search: '', status: '', asset: '', dateRange: '', ...overrides },
    updateFilters,
    clearFilters,
  });
  return { updateFilters, clearFilters };
}

describe('SearchFilterBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not call updateFilters until the debounce window elapses, then calls it once with the final value', () => {
    const { updateFilters } = mockFilters();
    render(<SearchFilterBar />);

    const input = screen.getByPlaceholderText(/search by id/i);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(updateFilters).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(updateFilters).toHaveBeenCalledTimes(1);
    expect(updateFilters).toHaveBeenCalledWith({ search: 'abc' });
  });

  it('reflects an external filters.search change in the rendered input value', () => {
    mockFilters({ search: 'initial' });
    const { rerender } = render(<SearchFilterBar />);

    const input = screen.getByPlaceholderText(/search by id/i) as HTMLInputElement;
    expect(input.value).toBe('initial');

    mockFilters({ search: 'external-change' });
    rerender(<SearchFilterBar />);

    expect((screen.getByPlaceholderText(/search by id/i) as HTMLInputElement).value).toBe(
      'external-change',
    );
  });

  it('wires status, asset and date controls to updateFilters and the button to clearFilters', () => {
    const { updateFilters, clearFilters } = mockFilters();
    render(<SearchFilterBar />);

    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'Settled' } });
    expect(updateFilters).toHaveBeenCalledWith({ status: 'Settled' });

    fireEvent.change(screen.getByDisplayValue('All Assets'), { target: { value: 'XLM' } });
    expect(updateFilters).toHaveBeenCalledWith({ asset: 'XLM' });

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-01-01' } });
    expect(updateFilters).toHaveBeenCalledWith({ dateRange: '2026-01-01' });

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });
});
