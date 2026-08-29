import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pagination, pageWindow } from './pagination';

describe('pageWindow', () => {
  it('lists every page when there are seven or fewer', () => {
    expect(pageWindow(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(3, 1)).toEqual([1]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('pins the first and last pages with an ellipsis for the gap', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 19, 20]);
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, '…', 20]);
  });
});

describe('Pagination', () => {
  const buttonHtml = (html: string, label: string) =>
    html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';

  // The button classes include `disabled:cursor-not-allowed` even when enabled,
  // so look for the actual `disabled` attribute rather than the substring.
  const isDisabled = (html: string, label: string) => /\sdisabled=/.test(buttonHtml(html, label));

  it('renders nothing when there is a single page', () => {
    const html = renderToString(<Pagination page={1} totalPages={1} onPageChange={() => {}} />);
    expect(html).toBe('');
  });

  it('renders nothing when there are no pages at all', () => {
    const html = renderToString(<Pagination page={1} totalPages={0} onPageChange={() => {}} />);
    expect(html).toBe('');
  });

  it('disables Previous on the first page but not Next', () => {
    const html = renderToString(<Pagination page={1} totalPages={5} onPageChange={() => {}} />);
    expect(isDisabled(html, 'Previous')).toBe(true);
    expect(isDisabled(html, 'Next')).toBe(false);
  });

  it('disables Next on the last page but not Previous', () => {
    const html = renderToString(<Pagination page={5} totalPages={5} onPageChange={() => {}} />);
    expect(isDisabled(html, 'Next')).toBe(true);
    expect(isDisabled(html, 'Previous')).toBe(false);
  });

  it('marks the current page with aria-current and labels every page button', () => {
    const html = renderToString(<Pagination page={3} totalPages={5} onPageChange={() => {}} />);
    expect(html).toContain('aria-current="page"');
    for (const n of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`aria-label="Page ${n}"`);
    }
  });

  it('exposes a labelled navigation landmark', () => {
    const html = renderToString(<Pagination page={1} totalPages={3} onPageChange={() => {}} />);
    expect(html).toContain('<nav aria-label="Pagination"');
  });
});
