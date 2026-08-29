import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

import Dashboard from './page';

describe('Dashboard totals, pagination honesty, and contrast', () => {
  it('renders loading skeleton matching total scale and table layout', () => {
    const html = renderToString(<Dashboard />);

    // Total loading placeholder matches h-10 sm:h-12 w-44 sm:w-56
    expect(html).toContain('h-10 sm:h-12 w-44 sm:w-56');
    // Renders responsive skeletons for mobile and desktop
    expect(html).toContain('class="md:hidden divide-y');
    expect(html).toContain('class="hidden md:block');
  });

  it('renders high contrast tokens complying with WCAG AA', () => {
    const html = renderToString(<Dashboard />);

    // Section header labels use accessible slate tokens (>= 4.5:1 on background)
    expect(html).toContain('text-slate-600 dark:text-slate-300');
    // Total settled label is accessible
    expect(html).toContain(
      'text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest',
    );
    // Emerald label uses emerald-700 on light
    expect(html).toContain('text-emerald-700 dark:text-emerald-400');
  });
});
