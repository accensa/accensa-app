import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

import LoginPage from './page';

describe('LoginPage design system consistency', () => {
  it('renders with consistent design system classes (PageContainer, bg-grid, backdrop blur, emerald palette)', () => {
    const html = renderToString(<LoginPage />);

    // Page container and background treatment
    expect(html).toContain('bg-grid');
    expect(html).toContain('max-w-3xl'); // PageContainer width="narrow"
    expect(html).toContain('max-w-md'); // w-full max-w-md

    // Blurred translucent panel with emerald glow
    expect(html).toContain('backdrop-blur-2xl');
    expect(html).toContain('bg-white/50');
    expect(html).toContain('dark:bg-white/5');
    expect(html).toContain('bg-emerald-500/10');

    // Typography hierarchy & tracking
    expect(html).toContain('tracking-[0.25em]');
    expect(html).toContain('Merchant Access');
    expect(html).toContain('Merchant Login');

    // Connect wallet button
    expect(html).toContain('bg-emerald-600');
    expect(html).toContain('dark:bg-emerald-500');
    expect(html).toContain('Connect Wallet');
    expect(html).toContain('aria-busy="false"');
  });

  it('does not contain undeclared semantic tokens or non-standard rounded classes', () => {
    const html = renderToString(<LoginPage />);

    // Undeclared semantic tokens that previously caused rendering bugs
    expect(html).not.toContain('bg-card');
    expect(html).not.toContain('text-muted-foreground');
    expect(html).not.toContain('bg-primary');
    expect(html).not.toContain('text-destructive');
    expect(html).not.toContain('bg-secondary');
    expect(html).not.toContain('text-primary-foreground');

    // Sharp corners (no rounded-* classes)
    expect(html).not.toContain('rounded-lg');
    expect(html).not.toContain('rounded-full');
    expect(html).not.toContain('rounded-md');
  });
});
