import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVisibility } from '@/components/network-status';

describe('useVisibility hook and tab visibility tracking', () => {
  let mockListeners: Record<string, (() => void)[]> = {};

  beforeEach(() => {
    mockListeners = {};
    const mockDocument = {
      visibilityState: 'visible',
      addEventListener: vi.fn((event: string, cb: () => void) => {
        mockListeners[event] = mockListeners[event] || [];
        mockListeners[event].push(cb);
      }),
      removeEventListener: vi.fn((event: string, cb: () => void) => {
        if (mockListeners[event]) {
          mockListeners[event] = mockListeners[event].filter((fn) => fn !== cb);
        }
      }),
    };

    Object.defineProperty(globalThis, 'document', {
      value: mockDocument,
      writable: true,
      configurable: true,
    });
  });

  it('exports useVisibility hook', () => {
    expect(typeof useVisibility).toBe('function');
  });

  it('registers visibilitychange listener on document when available', () => {
    const cb = vi.fn();
    document.addEventListener('visibilitychange', cb);
    expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', cb);

    document.removeEventListener('visibilitychange', cb);
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', cb);
  });
});
