import React from 'react';
import { brandCssVars, type Branding, type ColorMode } from '../../src/lib/branding';

interface BrandedCheckoutWrapperProps {
  branding: Branding;
  mode?: ColorMode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Scopes a merchant's brand (#450) to the checkout it wraps by injecting
 * `--brand-primary`, `--brand-primary-text`, `--brand-font` and `--brand-logo`
 * as CSS custom properties. Children style themselves with `var(--brand-*)`.
 * The same wrapper renders the live preview and the real checkout modal.
 */
export default function BrandedCheckoutWrapper({
  branding,
  mode = 'light',
  children,
  className,
}: BrandedCheckoutWrapperProps) {
  const style = {
    ...brandCssVars(branding, mode),
    fontFamily: 'var(--brand-font)',
    backgroundColor: mode === 'dark' ? '#0a111a' : '#ffffff',
    color: mode === 'dark' ? '#f1f5f9' : '#0f172a',
  } as React.CSSProperties;

  return (
    <div data-testid="branded-checkout" data-mode={mode} style={style} className={className}>
      {branding.logoDataUrl && (
        <div
          role="img"
          aria-label="Merchant logo"
          style={{
            height: 40,
            width: 120,
            backgroundImage: 'var(--brand-logo)',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'left center',
            backgroundSize: 'contain',
          }}
        />
      )}
      {children}
    </div>
  );
}
