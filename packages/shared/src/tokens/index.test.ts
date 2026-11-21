import { describe, expect, it } from 'vitest';
import { theme } from './index';

describe('theme tokens', () => {
  it('exports the color palette consumed by UI components', () => {
    expect(Object.keys(theme.colors).sort()).toEqual(
      ['background', 'error', 'primary', 'secondary', 'success', 'text'].sort(),
    );
    for (const value of Object.values(theme.colors)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('exports a font family and the typography scale', () => {
    expect(typeof theme.typography.fontFamily).toBe('string');
    expect(theme.typography.fontFamily.length).toBeGreaterThan(0);
    expect(Object.keys(theme.typography.fontSize)).toEqual(['small', 'medium', 'large']);
    for (const value of Object.values(theme.typography.fontSize)) {
      expect(value).toMatch(/^\d+(\.\d+)?px$/);
    }
  });

  it('exports the spacing scale', () => {
    expect(Object.keys(theme.spacing)).toEqual(['small', 'medium', 'large']);
    for (const value of Object.values(theme.spacing)) {
      expect(value).toMatch(/^\d+px$/);
    }
  });

  it('exports the shadow tokens', () => {
    expect(Object.keys(theme.shadows)).toEqual(['sm', 'md']);
    for (const value of Object.values(theme.shadows)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('keeps the scale ordered from smallest to largest', () => {
    const px = (value: string) => Number.parseInt(value, 10);
    const fontSizes = Object.values(theme.typography.fontSize).map(px);
    const spacing = Object.values(theme.spacing).map(px);
    expect(fontSizes).toEqual([...fontSizes].sort((a, b) => a - b));
    expect(spacing).toEqual([...spacing].sort((a, b) => a - b));
  });
});
