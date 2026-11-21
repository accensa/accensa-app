// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

import { OFFLINE_MESSAGE } from '@/lib/network-status';
import { OfflineBanner, useOnline, useVisibility } from './network-status';

// jsdom defines `navigator.onLine` and `document.visibilityState` as getters on
// the prototype. Shadow them with an own property on the instance and delete it
// afterwards so the prototype getter is what the next test sees again.
const restores: Array<() => void> = [];

function override<T extends object>(target: T, key: string, get: () => unknown) {
  Object.defineProperty(target, key, { configurable: true, get });
  restores.push(() => {
    delete (target as Record<string, unknown>)[key];
  });
}

let online = true;
let visibility: DocumentVisibilityState = 'visible';

function goOffline() {
  online = false;
  window.dispatchEvent(new Event('offline'));
}

function goOnline() {
  online = true;
  window.dispatchEvent(new Event('online'));
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function stubBrowserState() {
  online = true;
  visibility = 'visible';
  override(navigator, 'onLine', () => online);
  override(document, 'visibilityState', () => visibility);
}

afterEach(() => {
  while (restores.length > 0) restores.pop()!();
});

describe('useOnline', () => {
  it('returns true while navigator reports a connection', () => {
    stubBrowserState();
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
  });

  it('follows offline and online events through the real store subscription', () => {
    stubBrowserState();
    const { result } = renderHook(() => useOnline());

    act(() => goOffline());
    expect(result.current).toBe(false);

    act(() => goOnline());
    expect(result.current).toBe(true);
  });
});

describe('useVisibility', () => {
  it('returns false for hidden and true for visible after visibilitychange', () => {
    stubBrowserState();
    const { result } = renderHook(() => useVisibility());
    expect(result.current).toBe(true);

    act(() => setVisibility('hidden'));
    expect(result.current).toBe(false);

    act(() => setVisibility('visible'));
    expect(result.current).toBe(true);
  });
});

describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    stubBrowserState();
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a status region with the offline message, and removes it when back online', () => {
    stubBrowserState();
    render(<OfflineBanner />);

    act(() => goOffline());
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(OFFLINE_MESSAGE);

    act(() => goOnline());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
