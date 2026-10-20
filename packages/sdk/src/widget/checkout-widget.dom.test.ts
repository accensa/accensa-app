/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccensaCheckoutWidget } from './checkout-widget';

describe('AccensaCheckoutWidget DOM lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders when connected and removes its message listener on disconnect', () => {
    expect(customElements.get('accensa-checkout')).toBe(AccensaCheckoutWidget);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const widget = document.createElement('accensa-checkout') as AccensaCheckoutWidget;
    widget.setAttribute('amount', '12.50');
    document.body.append(widget);

    expect(widget.shadowRoot?.textContent).toContain('12.50');
    const registered = add.mock.calls.find(([type]) => type === 'message')?.[1];
    expect(registered).toBeTypeOf('function');

    widget.remove();

    const removed = remove.mock.calls.find(([type]) => type === 'message')?.[1];
    expect(removed).toBe(registered);
  });
});
