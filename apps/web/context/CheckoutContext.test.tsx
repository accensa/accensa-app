// @vitest-environment jsdom
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckoutProvider, useCheckout } from './CheckoutContext';

function wrapper(props: { subtotal: number; tipEnabled?: boolean }) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CheckoutProvider subtotal={props.subtotal} tipEnabled={props.tipEnabled}>
        {children}
      </CheckoutProvider>
    );
  }
  return Wrapper;
}

describe('CheckoutContext', () => {
  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useCheckout())).toThrow(/CheckoutProvider/);
  });

  it('starts with no tip and total equal to subtotal', () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper({ subtotal: 100 }) });
    expect(result.current.tipAmount).toBe(0);
    expect(result.current.total).toBe(100);
    expect(result.current.tipSelection).toBe('none');
  });

  it('computes a percentage tip and updates the total', () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper({ subtotal: 50 }) });
    act(() => result.current.setTipPercent(20));
    expect(result.current.tipAmount).toBe(10);
    expect(result.current.total).toBe(60);
    expect(result.current.tipSelection).toBe('percent');
  });

  it('lets a custom tip amount override the percentage selection', () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper({ subtotal: 50 }) });
    act(() => result.current.setTipPercent(20));
    act(() => result.current.setCustomTipAmount(3.5));
    expect(result.current.tipPercent).toBeNull();
    expect(result.current.tipAmount).toBe(3.5);
    expect(result.current.total).toBe(53.5);
    expect(result.current.tipSelection).toBe('custom');
  });

  it('clamps negative custom amounts to zero', () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper({ subtotal: 50 }) });
    act(() => result.current.setCustomTipAmount(-5));
    expect(result.current.tipAmount).toBe(0);
  });

  it('ignores tip selections entirely when the merchant disables tipping', () => {
    const { result } = renderHook(() => useCheckout(), {
      wrapper: wrapper({ subtotal: 50, tipEnabled: false }),
    });
    act(() => result.current.setTipPercent(20));
    expect(result.current.tipAmount).toBe(0);
    expect(result.current.total).toBe(50);
    expect(result.current.tipSelection).toBe('none');
  });

  it('clearTip resets both percent and custom selections', () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrapper({ subtotal: 50 }) });
    act(() => result.current.setCustomTipAmount(10));
    act(() => result.current.clearTip());
    expect(result.current.tipAmount).toBe(0);
    expect(result.current.tipSelection).toBe('none');
  });
});
