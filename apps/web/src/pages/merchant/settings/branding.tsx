import React, { useMemo, useState, useSyncExternalStore } from 'react';
import Head from 'next/head';
import BrandedCheckoutWrapper from '../../../../components/checkout/BrandedCheckoutWrapper';
import {
  DEFAULT_BRANDING,
  FONT_FAMILIES,
  MAX_LOGO_BYTES,
  checkContrast,
  isBranding,
  isHexColor,
  isSafeLogo,
  type Branding,
  type ColorMode,
  type FontKey,
} from '../../../lib/branding';

const STORAGE_KEY = 'accensa.merchant.branding';

const subscribe = () => () => {};

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): Branding {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isBranding(parsed) ? parsed : DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export default function BrandingSettings() {
  // Saved brand comes from storage via an external-store read (null on the
  // server), and edits live in `draft` until saved.
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const saved0 = useMemo(() => parseStored(stored), [stored]);
  const [draft, setDraft] = useState<Branding | null>(null);
  const branding = draft ?? saved0;
  const setBranding = (update: (b: Branding) => Branding) => setDraft(update(branding));
  const [mode, setMode] = useState<ColorMode>('light');
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const hexInput = hexDraft ?? branding.accentColor;
  const setHexInput = setHexDraft;
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const report = checkContrast(branding.accentColor);

  function onColor(value: string) {
    setHexInput(value);
    setSaved(false);
    if (isHexColor(value)) setBranding((b) => ({ ...b, accentColor: value.toLowerCase() }));
  }

  function onLogo(file: File | undefined) {
    setLogoError(null);
    setSaved(false);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(`Logo must be ${MAX_LOGO_BYTES / 1024} KB or smaller.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (!isSafeLogo(url)) {
        setLogoError('Logo must be a PNG, JPEG or WebP image.');
        return;
      }
      setBranding((b) => ({ ...b, logoDataUrl: url }));
    };
    reader.onerror = () => setLogoError('Could not read that file.');
    reader.readAsDataURL(file);
  }

  function save() {
    if (!report.ok) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
      setSaved(true);
    } catch {
      setLogoError('Could not save: browser storage is unavailable.');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <Head>
        <title>Checkout Branding - Settings</title>
      </Head>
      <div className="max-w-5xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold text-gray-900">Checkout Branding</h1>
          <p className="text-gray-500 mt-1">
            Match the checkout to your brand. The preview updates as you type.
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          <form
            className="bg-white p-6 rounded border border-gray-100 shadow-sm space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div>
              <label htmlFor="logo" className="block text-sm font-medium text-gray-700">
                Logo (PNG, JPEG or WebP, up to {MAX_LOGO_BYTES / 1024} KB)
              </label>
              <input
                id="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onLogo(e.target.files?.[0])}
                className="mt-2 block w-full text-sm"
              />
              {logoError && (
                <p role="alert" className="mt-1 text-sm text-red-600">
                  {logoError}
                </p>
              )}
              {branding.logoDataUrl && (
                <button
                  type="button"
                  className="mt-2 text-sm text-gray-600 underline"
                  onClick={() => {
                    setBranding((b) => ({ ...b, logoDataUrl: null }));
                    setSaved(false);
                  }}
                >
                  Remove logo
                </button>
              )}
            </div>

            <div>
              <label htmlFor="accent" className="block text-sm font-medium text-gray-700">
                Brand colour
              </label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Pick brand colour"
                  value={branding.accentColor}
                  onChange={(e) => onColor(e.target.value)}
                  className="h-10 w-12 border rounded"
                />
                <input
                  id="accent"
                  value={hexInput}
                  onChange={(e) => onColor(e.target.value)}
                  spellCheck={false}
                  aria-invalid={!isHexColor(hexInput)}
                  aria-describedby="accent-status"
                  className="w-32 border rounded px-3 py-2 font-mono text-sm"
                />
              </div>
              <div id="accent-status" aria-live="polite" className="mt-2 text-sm">
                {!isHexColor(hexInput) ? (
                  <p className="text-red-600">Enter a colour like #059669.</p>
                ) : report.ok ? (
                  <p className="text-emerald-700">
                    Passes WCAG AA: button text {report.buttonTextRatio.toFixed(2)}:1.
                  </p>
                ) : (
                  report.issues.map((issue) => (
                    <p key={issue} className="text-red-600">
                      {issue}
                    </p>
                  ))
                )}
              </div>
            </div>

            <div>
              <label htmlFor="font" className="block text-sm font-medium text-gray-700">
                Font
              </label>
              <select
                id="font"
                value={branding.fontFamily}
                onChange={(e) => {
                  setBranding((b) => ({ ...b, fontFamily: e.target.value as FontKey }));
                  setSaved(false);
                }}
                className="mt-2 border rounded px-3 py-2 text-sm"
              >
                {(Object.keys(FONT_FAMILIES) as FontKey[]).map((key) => (
                  <option key={key} value={key}>
                    {key === 'sans' ? 'Sans-serif' : key === 'serif' ? 'Serif' : 'Monospace'}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={!report.ok || !isHexColor(hexInput)}
                className="bg-gray-900 text-white px-4 py-2 rounded font-medium disabled:opacity-40"
              >
                Save branding
              </button>
              {saved && (
                <span role="status" className="text-sm text-emerald-700">
                  Saved.
                </span>
              )}
            </div>
          </form>

          <section aria-label="Live preview" className="space-y-3">
            <div className="flex gap-2" role="group" aria-label="Preview mode">
              {(['light', 'dark'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 rounded text-sm border ${mode === m ? 'bg-gray-900 text-white' : 'bg-white'}`}
                >
                  {m === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
            <BrandedCheckoutWrapper
              branding={branding}
              mode={mode}
              className="rounded-lg border border-gray-200 p-6 space-y-4 shadow-sm"
            >
              <h2 className="text-xl font-semibold">Complete your payment</h2>
              <p className="text-sm opacity-70">Order total</p>
              <p className="text-3xl font-bold" style={{ color: 'var(--brand-primary)' }}>
                12.50 USDC
              </p>
              <button
                type="button"
                className="w-full rounded px-4 py-3 font-semibold"
                style={{
                  backgroundColor: 'var(--brand-primary)',
                  color: 'var(--brand-primary-text)',
                }}
              >
                Pay now
              </button>
            </BrandedCheckoutWrapper>
          </section>
        </div>
      </div>
    </div>
  );
}
