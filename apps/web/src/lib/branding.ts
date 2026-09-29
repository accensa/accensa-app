/**
 * Merchant checkout branding (#450): colour maths, WCAG contrast validation,
 * and the CSS custom properties injected into the checkout modal.
 *
 * Deliberately a closed vocabulary: a hex colour, a font from a fixed list and
 * a raster logo. There is no free-form CSS, so a saved brand can never inject
 * arbitrary styles into the checkout.
 */

export type ColorMode = 'light' | 'dark';

export const FONT_FAMILIES = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export type FontKey = keyof typeof FONT_FAMILIES;

export interface Branding {
  /** `#rrggbb`. */
  accentColor: string;
  fontFamily: FontKey;
  /** `data:image/(png|jpeg|webp);base64,…`, or null for the default mark. */
  logoDataUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  accentColor: '#059669',
  fontFamily: 'sans',
  logoDataUrl: null,
};

/** WCAG 2.x AA: 4.5:1 for normal text, 3:1 for UI components and large text. */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#0a111a';

export const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function isSafeLogo(value: string): boolean {
  return LOGO_URL.test(value);
}

/** Whether `value` is a well-formed {@link Branding}; used to trust stored data. */
export function isBranding(value: unknown): value is Branding {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accentColor === 'string' &&
    isHexColor(v.accentColor) &&
    typeof v.fontFamily === 'string' &&
    Object.hasOwn(FONT_FAMILIES, v.fontFamily) &&
    (v.logoDataUrl === null || (typeof v.logoDataUrl === 'string' && isSafeLogo(v.logoDataUrl)))
  );
}

function toRgb(hex: string): [number, number, number] {
  if (!isHexColor(hex)) throw new RangeError(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever of white or black reads better on `background`. */
export function readableTextColor(background: string): '#ffffff' | '#000000' {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
    ? '#ffffff'
    : '#000000';
}

export interface ContrastReport {
  /** Accent as a UI element (border, focus ring) on the light surface. */
  onLight: number;
  /** Accent as a UI element on the dark surface. */
  onDark: number;
  /** Label colour used on an accent-filled button, and its contrast. */
  buttonText: '#ffffff' | '#000000';
  buttonTextRatio: number;
  /** Every problem found; empty when the colour passes. */
  issues: string[];
  ok: boolean;
}

/**
 * Checks an accent colour against WCAG AA. Whichever of white or black reads
 * better on the accent always reaches 4.5:1, so the button label cannot fail;
 * the real risk is an accent too pale to see as a UI element (borders, focus
 * rings, the amount) on the white checkout, which needs 3:1. Dark mode is not
 * validated here because {@link adaptAccent} always corrects it.
 */
export function checkContrast(accent: string): ContrastReport {
  const onLight = contrastRatio(accent, LIGHT_SURFACE);
  const onDark = contrastRatio(accent, DARK_SURFACE);
  const buttonText = readableTextColor(accent);
  const buttonTextRatio = contrastRatio(accent, buttonText);
  const issues: string[] = [];
  if (onLight < AA_UI) {
    issues.push(
      `This colour is too light: it reaches only ${onLight.toFixed(2)}:1 on the white checkout (WCAG AA needs ${AA_UI}:1). Choose a darker shade.`,
    );
  }
  return { onLight, onDark, buttonText, buttonTextRatio, issues, ok: issues.length === 0 };
}

/**
 * Nudges `accent` toward white or black until it reaches 3:1 against
 * `surface`, so a brand colour that works on a light checkout still shows on a
 * dark one. Returns the colour unchanged when it already passes.
 */
export function adaptAccent(accent: string, mode: ColorMode): string {
  const surface = mode === 'dark' ? DARK_SURFACE : LIGHT_SURFACE;
  const target: [number, number, number] = mode === 'dark' ? [255, 255, 255] : [0, 0, 0];
  const rgb = toRgb(accent);
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const candidate = toHex(rgb.map((c, i) => c + (target[i] - c) * t) as [number, number, number]);
    if (contrastRatio(candidate, surface) >= AA_UI) return candidate;
  }
  return toHex(target);
}

/** CSS custom properties for the checkout wrapper. Values are always sanitised. */
export function brandCssVars(branding: Branding, mode: ColorMode): Record<string, string> {
  const safe = isBranding(branding) ? branding : DEFAULT_BRANDING;
  const primary = adaptAccent(safe.accentColor, mode);
  return {
    '--brand-primary': primary,
    '--brand-primary-text': readableTextColor(primary),
    '--brand-font': FONT_FAMILIES[safe.fontFamily],
    '--brand-logo': safe.logoDataUrl ? `url("${safe.logoDataUrl}")` : 'none',
  };
}
