// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WidgetSkeleton } from './widget-skeleton';

function renderedRows(container: HTMLElement) {
  const body = container.querySelector('.space-y-4');
  expect(body).not.toBeNull();
  return body?.children.length ?? -1;
}

describe('WidgetSkeleton table variant', () => {
  it.each([
    { rows: -1, expected: 0 },
    { rows: 2.5, expected: 2 },
    { rows: Number.NaN, expected: 5 },
  ])('renders without throwing for rows=$rows and shows $expected row(s)', ({ rows, expected }) => {
    const { container } = render(<WidgetSkeleton variant="table" rows={rows} />);

    expect(renderedRows(container)).toBe(expected);
  });

  it('renders three rows when rows is three', () => {
    const { container } = render(<WidgetSkeleton variant="table" rows={3} />);

    expect(renderedRows(container)).toBe(3);
  });

  it('renders five rows when rows is omitted', () => {
    const { container } = render(<WidgetSkeleton variant="table" />);

    expect(renderedRows(container)).toBe(5);
  });
});
