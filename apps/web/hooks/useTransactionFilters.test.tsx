// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRouter } from 'next/router';
import { useTransactionFilters } from './useTransactionFilters';

vi.mock('next/router', () => ({
  useRouter: vi.fn(),
}));

const mockUseRouter = vi.mocked(useRouter);

function mockRouter(query: Record<string, unknown>) {
  const push = vi.fn();
  mockUseRouter.mockReturnValue({
    query,
    pathname: '/transactions',
    push,
  } as unknown as ReturnType<typeof useRouter>);
  return { push };
}

describe('useTransactionFilters', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps a string query value through for each filter key', () => {
    mockRouter({ search: 'abc', status: 'Settled', asset: 'XLM', dateRange: '2026-01-01' });

    const { result } = renderHook(() => useTransactionFilters());

    expect(result.current.filters).toEqual({
      search: 'abc',
      status: 'Settled',
      asset: 'XLM',
      dateRange: '2026-01-01',
    });
  });

  it('turns an array value and an absent value into an empty string without throwing', () => {
    mockRouter({ search: ['a', 'b'] });

    const { result } = renderHook(() => useTransactionFilters());

    expect(result.current.filters).toEqual({
      search: '',
      status: '',
      asset: '',
      dateRange: '',
    });
  });

  it('updateFilters pushes a shallow merge and drops keys set to empty', () => {
    const { push } = mockRouter({ search: 'abc', status: 'Settled' });

    const { result } = renderHook(() => useTransactionFilters());

    result.current.updateFilters({ search: '', asset: 'USDC' });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      { pathname: '/transactions', query: { status: 'Settled', asset: 'USDC' } },
      undefined,
      { shallow: true },
    );
  });

  it('clearFilters pushes an empty query object', () => {
    const { push } = mockRouter({ search: 'abc' });

    const { result } = renderHook(() => useTransactionFilters());

    result.current.clearFilters();

    expect(push).toHaveBeenCalledWith({ pathname: '/transactions', query: {} }, undefined, {
      shallow: true,
    });
  });

  it('re-derives filters when router.query identity changes', () => {
    mockRouter({ search: 'first' });

    const { result, rerender } = renderHook(() => useTransactionFilters());
    expect(result.current.filters.search).toBe('first');

    mockRouter({ search: 'second' });
    rerender();

    expect(result.current.filters.search).toBe('second');
  });
});
