import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// SecureChat has its own suite; stub it so this test covers only the page shell.
vi.mock('@/components/secure-chat', () => ({
  SecureChat: () => <div data-testid="secure-chat-stub" />,
}));

import SupportPage, { metadata } from './page';

// The default title set in `app/layout.tsx`. Kept as a literal because the root
// layout loads fonts and global CSS that do not resolve outside the Next build.
const ROOT_DEFAULT_TITLE = 'Accensa - provable payments for x402 sellers on Stellar';

describe('Support page', () => {
  it('exports its own metadata instead of falling back to the root default', () => {
    expect(metadata).toBeDefined();
    expect(typeof metadata.title).toBe('string');
    expect(metadata.title).toContain('Support');
    expect(metadata.title).not.toBe(ROOT_DEFAULT_TITLE);
    expect((metadata.title as string).trim().length).toBeGreaterThan(0);

    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).trim().length).toBeGreaterThan(0);
  });

  it('renders the Secure channel eyebrow and exactly one Support heading', () => {
    const html = renderToString(<SupportPage />);

    const headings = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
    expect(headings.map((h) => h.replace(/<[^>]+>/g, '').trim())).toEqual(['Support']);

    expect(html).toContain('Secure channel');
    expect(html).toContain('data-testid="secure-chat-stub"');
  });
});
