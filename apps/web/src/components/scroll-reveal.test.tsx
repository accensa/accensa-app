// @vitest-environment jsdom

import React from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollReveal } from './scroll-reveal';

/**
 * Anything that can host the `IntersectionObserver` global the component
 * reads — `globalThis` and jsdom's `window` — typed so the test can install
 * and remove the mock without `any` casts.
 */
interface IntersectionObserverHost {
  IntersectionObserver?: typeof IntersectionObserver;
}

const globalHost = globalThis as unknown as IntersectionObserverHost;
const windowHost = window as unknown as IntersectionObserverHost;

class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  observeCalls: Element[] = [];
  unobserveCalls: Element[] = [];
  disconnectCalls = 0;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((element: Element) => {
    this.observeCalls.push(element);
  });

  unobserve = vi.fn((element: Element) => {
    this.unobserveCalls.push(element);
  });

  disconnect = vi.fn(() => {
    this.disconnectCalls++;
  });

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  simulateEntry(
    entry: Partial<IntersectionObserverEntry> & { isIntersecting: boolean; target?: Element },
  ) {
    const target = entry.target ?? this.observeCalls[0];
    // `isIntersecting` is spread in from `entry` below rather than listed here
    // — repeating it would trip TS2783 (the spread overwrites it anyway).
    const constructedEntry = {
      time: Date.now(),
      target,
      intersectionRatio: entry.isIntersecting ? 1 : 0,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      ...entry,
    } as IntersectionObserverEntry;

    act(() => {
      this.callback([constructedEntry], this);
    });
  }
}

describe('ScrollReveal', () => {
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    MockIntersectionObserver.instances = [];
    originalIntersectionObserver = globalHost.IntersectionObserver;
    globalHost.IntersectionObserver = MockIntersectionObserver;
    windowHost.IntersectionObserver = MockIntersectionObserver;
    delete document.documentElement.dataset.srReady;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalIntersectionObserver) {
      globalHost.IntersectionObserver = originalIntersectionObserver;
      windowHost.IntersectionObserver = originalIntersectionObserver;
    } else {
      delete globalHost.IntersectionObserver;
      delete windowHost.IntersectionObserver;
    }
    delete document.documentElement.dataset.srReady;
  });

  it('sets document srReady dataset flag and configures observer with expected threshold and rootMargin', () => {
    render(
      <ScrollReveal>
        <span>Content</span>
      </ScrollReveal>,
    );

    expect(document.documentElement.dataset.srReady).toBe('1');
    expect(MockIntersectionObserver.instances).toHaveLength(1);
    const observer = MockIntersectionObserver.instances[0];
    expect(observer.options).toEqual({
      threshold: 0,
      rootMargin: '0px',
    });
  });

  it('keeps children unrevealed (without is-visible class) before any intersection entry is reported', () => {
    render(
      <ScrollReveal>
        <span>Reveal Target</span>
      </ScrollReveal>,
    );

    // Advance 100ms timer so observer.observe(ref.current) is called
    act(() => {
      vi.advanceTimersByTime(100);
    });

    const observer = MockIntersectionObserver.instances[0];
    const container = screen.getByText('Reveal Target').parentElement!;

    expect(observer.observeCalls).toContain(container);
    // Visibility is controlled via the 'is-visible' class defined in globals.css
    expect(container).toHaveClass('scroll-reveal');
    expect(container).not.toHaveClass('is-visible');
  });

  it('leaves children hidden when an entry with isIntersecting false is reported', () => {
    render(
      <ScrollReveal>
        <span>Hidden Target</span>
      </ScrollReveal>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const observer = MockIntersectionObserver.instances[0];
    const container = screen.getByText('Hidden Target').parentElement!;

    observer.simulateEntry({ isIntersecting: false, target: container });

    expect(container).toHaveClass('scroll-reveal');
    expect(container).not.toHaveClass('is-visible');
    expect(observer.unobserveCalls).toHaveLength(0);
  });

  it('reveals children and unobserves element when an entry with isIntersecting true is reported', () => {
    render(
      <ScrollReveal>
        <span>Shown Target</span>
      </ScrollReveal>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const observer = MockIntersectionObserver.instances[0];
    const container = screen.getByText('Shown Target').parentElement!;

    observer.simulateEntry({ isIntersecting: true, target: container });

    expect(container).toHaveClass('is-visible');
    expect(observer.unobserveCalls).toContain(container);
    expect(observer.unobserve).toHaveBeenCalledTimes(1);
  });

  it('retains revealed state when a subsequent non-intersecting entry occurs (reveal-once contract)', () => {
    render(
      <ScrollReveal>
        <span>Once Target</span>
      </ScrollReveal>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const observer = MockIntersectionObserver.instances[0];
    const container = screen.getByText('Once Target').parentElement!;

    // Reveal
    observer.simulateEntry({ isIntersecting: true, target: container });
    expect(container).toHaveClass('is-visible');

    // Subsequent non-intersecting entry should not re-hide
    observer.simulateEntry({ isIntersecting: false, target: container });
    expect(container).toHaveClass('is-visible');
  });

  it('disconnects the observer exactly once upon unmounting after observation', () => {
    const { unmount } = render(
      <ScrollReveal>
        <span>Unmount Target</span>
      </ScrollReveal>,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const observer = MockIntersectionObserver.instances[0];
    expect(observer.disconnectCalls).toBe(0);

    unmount();

    expect(observer.disconnectCalls).toBe(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cleans up and clears pending timer when unmounting before timer fires or any intersection', () => {
    const { unmount } = render(
      <ScrollReveal>
        <span>Early Unmount Target</span>
      </ScrollReveal>,
    );

    const observer = MockIntersectionObserver.instances[0];
    expect(observer.observeCalls).toHaveLength(0);

    unmount();

    expect(observer.disconnectCalls).toBe(1);

    // Advancing timers should not cause observer.observe to be called
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(observer.observeCalls).toHaveLength(0);
  });

  it('renders with custom element tag when as prop is supplied', () => {
    render(
      <ScrollReveal as="section" className="custom-class">
        <span>Section Content</span>
      </ScrollReveal>,
    );

    const container = screen.getByText('Section Content').parentElement!;
    expect(container.tagName).toBe('SECTION');
    expect(container).toHaveClass('scroll-reveal');
    expect(container).toHaveClass('custom-class');
  });

  it('throws when IntersectionObserver is undefined in the environment, confirming lack of fallback handling', () => {
    delete globalHost.IntersectionObserver;
    delete windowHost.IntersectionObserver;

    expect(() => {
      render(
        <ScrollReveal>
          <span>No Observer</span>
        </ScrollReveal>,
      );
    }).toThrow();
  });
});
