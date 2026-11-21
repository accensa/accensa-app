// @vitest-environment jsdom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetTheme } = vi.hoisted(() => ({ mockSetTheme: vi.fn() }));

vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: mockSetTheme }) }));

import { ThemeToggle } from './theme-toggle';

function storeTheme(value: string | null) {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) =>
    key === 'theme' ? value : null,
  );
}

beforeEach(() => {
  mockSetTheme.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeToggle initial state', () => {
  it('labels the button "System theme" when nothing is stored', async () => {
    storeTheme(null);
    await act(async () => {
      render(<ThemeToggle />);
    });
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
  });

  it('falls back to "System theme" when reading the store throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    await act(async () => {
      render(<ThemeToggle />);
    });
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
  });

  it('falls back to "System theme" for an unknown stored value', async () => {
    storeTheme('sepia');
    await act(async () => {
      render(<ThemeToggle />);
    });
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
  });

  it('reads a stored "oled" theme as "OLED mode"', async () => {
    storeTheme('oled');
    await act(async () => {
      render(<ThemeToggle />);
    });
    expect(screen.getByRole('button', { name: 'OLED mode' })).toBeInTheDocument();
  });
});

describe('ThemeToggle mount placeholder', () => {
  it('renders a placeholder with no button before mount, then swaps in the button', async () => {
    storeTheme('light');

    // renderToString never runs effects, so it shows the pre-mount output.
    const beforeMount = renderToString(<ThemeToggle />);
    expect(beforeMount).toContain('animate-pulse');
    expect(beforeMount).not.toContain('<button');

    const { container } = render(<ThemeToggle />);
    await act(async () => {});

    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
  });
});

describe('ThemeToggle cycling', () => {
  it('calls setTheme once with "dark" when clicked from the light index', async () => {
    storeTheme('light');
    await act(async () => {
      render(<ThemeToggle />);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Light mode' }));

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument();
  });
});
