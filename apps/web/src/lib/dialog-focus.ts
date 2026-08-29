/**
 * The focus bookkeeping a modal dialog needs: find what is focusable inside it,
 * keep Tab from leaving it, and hand focus back to whatever opened it on close.
 *
 * These are plain functions rather than a hook so they can be tested without a
 * DOM — the payment-details modal is the only caller, and its own test suite
 * runs in Node.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Anything the browser lets you Tab to, inside `container`, in document order. */
export function getFocusable(container: Pick<ParentNode, 'querySelectorAll'>): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Where Tab (or Shift+Tab) should move focus to keep it inside the dialog.
 *
 * Returns `null` when the browser's own behaviour already keeps focus in the
 * dialog — the caller should not `preventDefault` in that case. Returns an
 * element when focus is about to escape and must be wrapped to the other end.
 */
export function wrapTabTarget(
  focusable: HTMLElement[],
  active: HTMLElement | null,
  shiftKey: boolean,
): HTMLElement | null {
  if (focusable.length === 0) return null;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeIsInside = active !== null && focusable.includes(active);

  if (shiftKey) {
    // Backwards past the first element, or from somewhere outside the set.
    return active === first || !activeIsInside ? last : null;
  }
  // Forwards past the last element, or from somewhere outside the set.
  return active === last || !activeIsInside ? first : null;
}

/**
 * Captures the currently-focused element and returns a function that restores
 * focus to it. Call the capture at open, the returned function at close, so a
 * keyboard user lands back on the control they opened the dialog from rather
 * than at the top of the document.
 */
export function focusRestorer(previouslyFocused: HTMLElement | null): () => void {
  return () => {
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };
}
