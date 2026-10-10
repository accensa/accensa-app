import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StockIndicator } from './StockIndicator';

describe('StockIndicator', () => {
  it('shows a low stock warning below the configured threshold', () => {
    const markup = renderToStaticMarkup(<StockIndicator available={2} lowStockThreshold={5} />);
    expect(markup).toContain('Only 2 items left');
    expect(markup).toContain('role="status"');
  });

  it('does not show a warning at or above threshold and marks sold-out items', () => {
    expect(renderToStaticMarkup(<StockIndicator available={5} lowStockThreshold={5} />)).toBe('');
    expect(renderToStaticMarkup(<StockIndicator available={0} lowStockThreshold={5} />)).toContain(
      'Out of stock',
    );
  });
});
