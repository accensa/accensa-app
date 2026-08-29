import { describe, expect, it, vi } from 'vitest';
import { focusRestorer, getFocusable, wrapTabTarget } from './dialog-focus';

/** A stand-in for an HTMLElement that records focus() calls. */
function el(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return { focus: vi.fn(), getAttribute: () => null, ...overrides } as unknown as HTMLElement;
}

describe('getFocusable', () => {
  it('returns the container’s focusable elements and drops aria-hidden ones', () => {
    const visible = el();
    const hidden = el({ getAttribute: (name: string) => (name === 'aria-hidden' ? 'true' : null) });
    const container = { querySelectorAll: () => [visible, hidden] } as unknown as ParentNode;

    expect(getFocusable(container)).toEqual([visible]);
  });
});

describe('wrapTabTarget', () => {
  const a = el();
  const b = el();
  const c = el();
  const focusable = [a, b, c];

  it('does nothing while focus is mid-dialog', () => {
    expect(wrapTabTarget(focusable, b, false)).toBeNull();
    expect(wrapTabTarget(focusable, b, true)).toBeNull();
  });

  it('wraps forward from the last element to the first', () => {
    expect(wrapTabTarget(focusable, c, false)).toBe(a);
  });

  it('wraps backward from the first element to the last', () => {
    expect(wrapTabTarget(focusable, a, true)).toBe(c);
  });

  it('pulls focus back in when it has escaped the dialog', () => {
    expect(wrapTabTarget(focusable, el(), false)).toBe(a);
    expect(wrapTabTarget(focusable, null, true)).toBe(c);
  });

  it('is a no-op when the dialog has nothing focusable', () => {
    expect(wrapTabTarget([], a, false)).toBeNull();
  });
});

describe('focusRestorer', () => {
  it('returns focus to the captured element', () => {
    const opener = el();
    focusRestorer(opener)();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing was focused', () => {
    expect(() => focusRestorer(null)()).not.toThrow();
  });
});
