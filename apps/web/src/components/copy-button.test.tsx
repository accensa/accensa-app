import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton } from './copy-button';

describe('CopyButton component', () => {
  it('renders initial copy button with accessible label and polite live region', () => {
    const html = renderToString(
      <CopyButton
        value="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        label="Transaction Hash"
      />,
    );

    expect(html).toContain('aria-label="Copy Transaction Hash"');
    expect(html).toContain('title="Copy Transaction Hash"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Copy');
  });
});
