import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRANDING,
  adaptAccent,
  brandCssVars,
  checkContrast,
  contrastRatio,
  isBranding,
  isHexColor,
  isSafeLogo,
  readableTextColor,
} from './branding';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the well-known 4.54:1 AA boundary grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBeCloseTo(
      contrastRatio('#fedcba', '#123456'),
      10,
    );
  });

  it('rejects malformed colours', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow(RangeError);
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow(RangeError);
  });
});

describe('checkContrast', () => {
  it('accepts the default brand colour', () => {
    expect(checkContrast(DEFAULT_BRANDING.accentColor).ok).toBe(true);
  });

  it('accepts a dark navy and picks white button text', () => {
    const report = checkContrast('#1e3a8a');
    expect(report.ok).toBe(true);
    expect(report.buttonText).toBe('#ffffff');
  });

  it('rejects a pale yellow that is unreadable on the white checkout', () => {
    const report = checkContrast('#ffff99');
    expect(report.onLight).toBeLessThan(3);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatch(/too light/);
  });

  it('sits exactly on the 3:1 boundary correctly', () => {
    // #959595 is ~3.0:1 on white; one step lighter must fail.
    expect(checkContrast('#949494').ok).toBe(true);
    expect(checkContrast('#a0a0a0').ok).toBe(false);
  });

  it('always finds a readable button label', () => {
    for (const hex of ['#808080', '#777777', '#ff0000', '#00ff00', '#0000ff', '#767676']) {
      expect(checkContrast(hex).buttonTextRatio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('readableTextColor', () => {
  it('chooses black on light and white on dark backgrounds', () => {
    expect(readableTextColor('#fafafa')).toBe('#000000');
    expect(readableTextColor('#0b1220')).toBe('#ffffff');
  });
});

describe('adaptAccent', () => {
  it('leaves an already-legible colour alone', () => {
    expect(adaptAccent('#1e3a8a', 'light')).toBe('#1e3a8a');
  });

  it('darkens a pale accent on the light surface until it reaches 3:1', () => {
    const adapted = adaptAccent('#ffff99', 'light');
    expect(adapted).not.toBe('#ffff99');
    expect(contrastRatio(adapted, '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('lightens a dark accent on the dark surface until it reaches 3:1', () => {
    const adapted = adaptAccent('#1e3a8a', 'dark');
    expect(contrastRatio(adapted, '#0a111a')).toBeGreaterThanOrEqual(3);
  });
});

describe('validation helpers', () => {
  it('validates hex colours', () => {
    expect(isHexColor('#0af0af')).toBe(true);
    expect(isHexColor('#0af')).toBe(false);
    expect(isHexColor('0af0af')).toBe(false);
    expect(isHexColor('#0af0ag')).toBe(false);
  });

  it('accepts only base64 raster data URLs for the logo', () => {
    expect(isSafeLogo('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeLogo('https://evil.example/logo.png')).toBe(false);
    expect(isSafeLogo('data:image/png;base64,AAAA"); background:url(x')).toBe(false);
  });

  it('isBranding rejects unknown fonts and unsafe logos', () => {
    expect(isBranding(DEFAULT_BRANDING)).toBe(true);
    expect(isBranding({ ...DEFAULT_BRANDING, fontFamily: 'comic' })).toBe(false);
    expect(isBranding({ ...DEFAULT_BRANDING, logoDataUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isBranding(null)).toBe(false);
  });
});

describe('brandCssVars', () => {
  it('emits the checkout custom properties', () => {
    const vars = brandCssVars(
      { ...DEFAULT_BRANDING, logoDataUrl: 'data:image/png;base64,AAAA' },
      'light',
    );
    expect(vars['--brand-primary']).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars['--brand-logo']).toBe('url("data:image/png;base64,AAAA")');
    expect(vars['--brand-font']).toContain('system-ui');
  });

  it('falls back to defaults for tampered input', () => {
    const vars = brandCssVars(
      { accentColor: 'red;}', fontFamily: 'sans', logoDataUrl: null },
      'light',
    );
    expect(vars['--brand-primary']).toBe(adaptAccent(DEFAULT_BRANDING.accentColor, 'light'));
    expect(vars['--brand-logo']).toBe('none');
  });

  it('adapts the primary colour per mode', () => {
    const b = { ...DEFAULT_BRANDING, accentColor: '#1e3a8a' };
    expect(brandCssVars(b, 'light')['--brand-primary']).not.toBe(
      brandCssVars(b, 'dark')['--brand-primary'],
    );
  });
});
