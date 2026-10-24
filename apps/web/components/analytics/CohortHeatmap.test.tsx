// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CohortHeatmap from './CohortHeatmap';

interface Cohort {
  cohort: string;
  size: number;
  retention: number[];
}

/**
 * Every shade getBackgroundColor() can return, darkest first. A cell must
 * carry exactly one of them, so asserting "the expected shade is present and
 * no other shade is" pins the whole ladder rather than a single step.
 */
const SHADES = [
  'bg-blue-600',
  'bg-blue-500',
  'bg-blue-400',
  'bg-blue-300',
  'bg-blue-200',
  'bg-blue-100',
  'bg-gray-50',
] as const;

/**
 * The threshold ladder, straddling every boundary: each exact boundary value
 * plus the value just below it, so a ladder that is off by one (>= 80 instead
 * of > 80, say) fails here.
 */
const THRESHOLDS: Array<{ pct: number; shade: string; text: string; why: string }> = [
  { pct: 100, shade: 'bg-blue-600', text: 'text-white', why: 'exactly 100 is the darkest shade' },
  // The first rung is an equality check, not a >= check: only *exactly* 100 is
  // the darkest shade. Retention above 100% cannot happen in the product, but
  // pinning it keeps the rung honest if the ladder is ever rewritten.
  { pct: 101, shade: 'bg-blue-500', text: 'text-white', why: '101 is not the darkest shade' },
  { pct: 99, shade: 'bg-blue-500', text: 'text-white', why: '99 falls through to the >=80 shade' },
  { pct: 80, shade: 'bg-blue-500', text: 'text-white', why: '80 is inclusive' },
  {
    pct: 79,
    shade: 'bg-blue-400',
    text: 'text-gray-900',
    why: '79 falls through to the >=60 shade',
  },
  { pct: 60, shade: 'bg-blue-400', text: 'text-gray-900', why: '60 is inclusive' },
  {
    pct: 59,
    shade: 'bg-blue-300',
    text: 'text-gray-900',
    why: '59 falls through to the >=40 shade',
  },
  { pct: 40, shade: 'bg-blue-300', text: 'text-gray-900', why: '40 is inclusive' },
  {
    pct: 39,
    shade: 'bg-blue-200',
    text: 'text-gray-900',
    why: '39 falls through to the >=20 shade',
  },
  { pct: 20, shade: 'bg-blue-200', text: 'text-gray-900', why: '20 is inclusive' },
  { pct: 19, shade: 'bg-blue-100', text: 'text-gray-900', why: '19 falls through to the >0 shade' },
  { pct: 1, shade: 'bg-blue-100', text: 'text-gray-900', why: '1 is the last non-zero shade' },
  { pct: 0, shade: 'bg-gray-50', text: 'text-gray-400', why: '0 is the empty shade' },
];

function renderHeatmap(data: Cohort[]) {
  return render(<CohortHeatmap data={data} />);
}

/** The retention cell rendering `pct` — its label is the percentage itself. */
function cellFor(pct: number): HTMLElement {
  return screen.getByText(`${pct.toFixed(0)}%`);
}

describe('CohortHeatmap', () => {
  describe('colour threshold ladder', () => {
    it.each(THRESHOLDS)('shades $pct% with $shade ($why)', ({ pct, shade, text }) => {
      renderHeatmap([{ cohort: '2026-01', size: 250, retention: [pct] }]);

      const cell = cellFor(pct);
      const applied = SHADES.filter((candidate) => cell.classList.contains(candidate));

      // Exactly one shade, and it is the one this percentage must land on.
      expect(applied).toEqual([shade]);
      // The shade and its paired text colour travel together.
      expect(cell).toHaveClass(shade, text);
    });

    it('gives every retention cell a percentage label', () => {
      renderHeatmap([{ cohort: '2026-01', size: 250, retention: [100, 80, 60, 40, 20, 1, 0] }]);

      for (const pct of [100, 80, 60, 40, 20, 1, 0]) {
        expect(cellFor(pct)).toBeInTheDocument();
      }
    });
  });

  describe('ragged rows', () => {
    it('pads a short row with empty cells so every row has the same column count', () => {
      const { container } = renderHeatmap([
        { cohort: '2026-01', size: 120, retention: [100, 80, 60] },
        { cohort: '2026-02', size: 40, retention: [40] },
      ]);

      // One header per month of the widest cohort, after the two fixed columns.
      const headers = screen.getAllByRole('columnheader');
      expect(headers.map((header) => header.textContent)).toEqual([
        'Cohort',
        'Users',
        'Month 0',
        'Month 1',
        'Month 2',
      ]);

      const rows = Array.from(container.querySelectorAll('tbody tr'));
      expect(rows).toHaveLength(2);

      // Cohort + Users + one cell per month — the short row is padded to match.
      for (const row of rows) {
        expect(row.querySelectorAll('td')).toHaveLength(5);
      }

      // The padded cells are empty: no label, no tooltip, just the grey filler.
      const padded = Array.from(rows[1].querySelectorAll('td')).slice(3);
      expect(padded).toHaveLength(2);
      for (const cell of padded) {
        expect(cell.textContent).toBe('');
        expect(cell).not.toHaveAttribute('title');
        expect(cell).toHaveClass('bg-gray-50');
      }

      // The widest row has no padding at all.
      const widest = Array.from(rows[0].querySelectorAll('td'));
      expect(widest).toHaveLength(5);
      expect(widest.every((cell) => cell.textContent !== '')).toBe(true);

      // The fixed columns carry the cohort label and its size.
      expect(widest[0]).toHaveTextContent('2026-01');
      expect(widest[1]).toHaveTextContent('120');
    });

    it('pads a row with no retention data at all to the width of the widest cohort', () => {
      const { container } = renderHeatmap([
        { cohort: '2026-01', size: 90, retention: [100, 50] },
        { cohort: '2026-02', size: 10, retention: [] },
      ]);

      const rows = Array.from(container.querySelectorAll('tbody tr'));
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.querySelectorAll('td')).toHaveLength(4);
      }

      const padded = Array.from(rows[1].querySelectorAll('td')).slice(2);
      expect(padded).toHaveLength(2);
      for (const cell of padded) {
        expect(cell.textContent).toBe('');
        expect(cell).not.toHaveAttribute('title');
      }
    });
  });

  describe('cell tooltip', () => {
    it('rounds the user count in the title', () => {
      renderHeatmap([{ cohort: '2026-01', size: 37, retention: [33] }]);

      // Math.round((33 / 100) * 37) === Math.round(12.21) === 12.
      expect(cellFor(33)).toHaveAttribute('title', '33% retention (12 users)');
    });

    it('rounds a half up to the next whole user', () => {
      renderHeatmap([{ cohort: '2026-01', size: 10, retention: [25] }]);

      // Math.round((25 / 100) * 10) === Math.round(2.5) === 3.
      expect(cellFor(25)).toHaveAttribute('title', '25% retention (3 users)');
    });

    it('reports zero users at 0% retention', () => {
      renderHeatmap([{ cohort: '2026-01', size: 500, retention: [0] }]);

      expect(cellFor(0)).toHaveAttribute('title', '0% retention (0 users)');
    });
  });

  describe('empty data', () => {
    it('renders a blank grid instead of throwing (maxMonths is -Infinity)', () => {
      // Root cause, pinned: Math.max() over an empty array is -Infinity.
      expect(Math.max(...([] as number[]))).toBe(-Infinity);
      // Array.from() runs ToLength() on that length, which clamps -Infinity to
      // 0 — so the -Infinity never reaches the DOM and nothing throws.
      expect(Array.from({ length: -Infinity })).toEqual([]);

      expect(() => renderHeatmap([])).not.toThrow();

      // The table still renders, with the two fixed columns and no month
      // columns, and no body rows.
      expect(screen.getByRole('table')).toBeInTheDocument();
      const headers = screen.getAllByRole('columnheader');
      expect(headers.map((header) => header.textContent)).toEqual(['Cohort', 'Users']);
      expect(screen.queryAllByRole('row')).toHaveLength(1);
    });
  });
});
