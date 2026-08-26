import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import VerifyPage, { Result } from './page';

describe('Verify page accessibility', () => {
  it('renders an in-progress status live region for screen readers', () => {
    const html = renderToString(<VerifyPage />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('sr-only');
  });

  it('renders the form submit button with aria-busy="false"', () => {
    const html = renderToString(<VerifyPage />);

    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('Verify Cryptographic Proof');
  });

  it('renders the verified Result block with live region, focusable tabIndex, and sr-only verdict label', () => {
    const resultRef = { current: null };
    const html = renderToString(
      <Result
        result={{
          verified: true,
          disagreement: false,
          contract: 'CC...',
          local: { ok: true },
          onchain: { ok: true },
          batch: {
            id: 1,
            count: 42,
            periodStart: 1700000000,
            periodEnd: 1700003600,
            root: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          },
        }}
        resultRef={resultRef}
      />,
    );

    // Live region and focus attributes
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Verification verdict"');
    expect(html).toContain('aria-live="polite"');

    // Standalone verdict heading with screen-reader context
    expect(html).toContain('sr-only">Verdict: </span>');
    expect(html).toContain('Proof Verified');

    // Decorative checkmark icon has aria-hidden
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders the rejected Result block with live region, focusable tabIndex, and sr-only verdict label', () => {
    const resultRef = { current: null };
    const html = renderToString(
      <Result
        result={{
          verified: false,
          disagreement: false,
          contract: 'CC...',
          local: { ok: false, error: 'Hash mismatch' },
          onchain: { ok: null },
        }}
        resultRef={resultRef}
      />,
    );

    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Verification verdict"');
    expect(html).toContain('aria-live="polite"');

    expect(html).toContain('sr-only">Verdict: </span>');
    expect(html).toContain('Proof Rejected');
  });

  it('renders copy button for the batch Merkle root with accessible label', () => {
    const resultRef = { current: null };
    const html = renderToString(
      <Result
        result={{
          verified: true,
          disagreement: false,
          contract: 'CC...',
          local: { ok: true },
          onchain: { ok: true },
          batch: {
            id: 1,
            count: 42,
            periodStart: 1700000000,
            periodEnd: 1700003600,
            root: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          },
        }}
        resultRef={resultRef}
      />,
    );

    expect(html).toContain('aria-label="Copy Merkle Root"');
    expect(html).toContain('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
