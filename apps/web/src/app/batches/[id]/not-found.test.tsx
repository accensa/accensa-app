import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BatchNotFound from './not-found';

function anchors(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
    label: inner.replace(/<[^>]+>/g, '').trim(),
  }));
}

describe('Batch not-found boundary', () => {
  it('offers exactly two exits: verify a receipt and back to Accensa', () => {
    const html = renderToString(<BatchNotFound />);

    expect(anchors(html)).toEqual([
      { href: '/verify', label: 'Verify a receipt' },
      { href: '/', label: 'Back to Accensa' },
    ]);
  });

  it('renders Batch not found as the only h1 and explains ids are sequential', () => {
    const html = renderToString(<BatchNotFound />);

    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings.map((h) => h.replace(/<[^>]+>/g, '').trim())).toEqual(['Batch not found']);
    expect(html.split('Batch not found')).toHaveLength(2);

    expect(html).toContain('Batch IDs are sequential');
    expect(html).toContain('start at 1');
  });
});
