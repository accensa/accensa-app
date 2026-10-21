// @vitest-environment jsdom
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStoreContext } from './StoreContext';

function wrapper({ children }: { children: React.ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}

function jsonResponse(ok: boolean, body: unknown) {
  return { ok, json: async () => body } as Response;
}

describe('StoreContext', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces the load error instead of hanging when the stores fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(false, {}));

    const { result } = renderHook(() => useStoreContext(), { wrapper });

    await act(async () => {
      await result.current.refreshStores();
    });

    expect(result.current.error).toBe('Unable to load stores');
    expect(result.current.loading).toBe(false);
  });

  it("persists 'organization' to localStorage when there is no active store", async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(true, { stores: [], activeStoreId: null }),
    );

    const { result } = renderHook(() => useStoreContext(), { wrapper });

    await act(async () => {
      await result.current.refreshStores();
    });

    expect(setItemSpy).toHaveBeenCalledWith('accensa:active-store', 'organization');
  });

  it('selectStore throws its message and does not reload on a failing POST', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(false, {}));

    const { result } = renderHook(() => useStoreContext(), { wrapper });

    await expect(
      act(async () => {
        await result.current.selectStore(1);
      }),
    ).rejects.toThrow('Unable to switch store');

    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('selectStore persists the id and reloads once on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(true, {}));

    const { result } = renderHook(() => useStoreContext(), { wrapper });

    await act(async () => {
      await result.current.selectStore(7);
    });

    expect(setItemSpy).toHaveBeenCalledWith('accensa:active-store', '7');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('useStoreContext throws the documented error outside StoreProvider', () => {
    const { result } = renderHook(() => {
      try {
        return useStoreContext();
      } catch (e) {
        return e;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toBe(
      'useStoreContext must be used within StoreProvider',
    );
  });
});
