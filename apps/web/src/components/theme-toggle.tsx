'use client';

import * as React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';

type Theme = 'light' | 'dark' | 'system';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

function getThemeLabel(theme: Theme) {
  switch (theme) {
    case 'light':
      return 'Light mode';
    case 'dark':
      return 'Dark mode';
    case 'system':
      return 'System theme';
  }
}

function ThemeIcon({ theme }: { theme: Theme }) {
  switch (theme) {
    case 'light':
      return <Sun className="h-4 w-4 pointer-events-none" />;
    case 'dark':
      return <Moon className="h-4 w-4 pointer-events-none" />;
    case 'system':
      return <Monitor className="h-4 w-4 pointer-events-none" />;
  }
}

function getInitialThemeIndex(): number {
  if (typeof window === 'undefined') return 2; // default to 'system'
  try {
    const stored = localStorage.getItem('theme') as Theme | null;
    const current = stored ?? 'system';
    const idx = THEME_ORDER.indexOf(current);
    return idx >= 0 ? idx : 2;
  } catch {
    return 2;
  }
}

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [currentThemeIndex, setCurrentThemeIndex] = React.useState(getInitialThemeIndex);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-9 h-9 bg-slate-200 dark:bg-white/10 animate-pulse" />;
  }

  const cycleTheme = () => {
    const nextIndex = (currentThemeIndex + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextIndex];
    setCurrentThemeIndex(nextIndex);
    setTheme(nextTheme);
  };

  const currentTheme = THEME_ORDER[currentThemeIndex];
  const label = getThemeLabel(currentTheme);

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="relative inline-flex h-9 w-9 items-center justify-center bg-white/40 dark:bg-white/5 text-slate-500 dark:text-slate-400 md:hover:bg-white/60 dark:md:hover:bg-white/10 active:bg-white/60 dark:active:bg-white/10 transition-colors shadow-sm dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)] cursor-pointer before:absolute before:-inset-1 before:content-['']"
      aria-label={label}
      title={label}
    >
      <ThemeIcon theme={currentTheme} />
    </button>
  );
}
