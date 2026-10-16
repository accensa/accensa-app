// @vitest-environment jsdom

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemStatusWidget } from './SystemStatusWidget';

vi.mock('@/lib/status/healthChecker', () => ({
  fetchSystemHealth: vi.fn(),
  overallHealth: vi.fn(() => 'operational'),
}));

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: {
      checkedAt: '2026-03-09T12:00:00.000Z',
      services: {
        rpc: 'operational',
        indexer: 'operational',
        relayer: 'operational',
      },
    },
    error: undefined,
  })),
}));

describe('SystemStatusWidget', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders trigger button and keeps panel content absent before opening', () => {
    render(<SystemStatusWidget />);
    expect(screen.getByRole('button', { name: /all systems operational/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('System status')).toBeNull();
  });

  it('opens the panel when the trigger button is clicked', () => {
    render(<SystemStatusWidget />);
    const trigger = screen.getByRole('button', { name: /all systems operational/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'System status', level: 2 })).toBeInTheDocument();
  });

  it('dismisses the panel when clicking the backdrop overlay', () => {
    render(<SystemStatusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /all systems operational/i }));

    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the panel open when clicking inside the panel', () => {
    render(<SystemStatusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /all systems operational/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'System status', level: 2 })).toBeInTheDocument();
  });

  it('dismisses the panel when clicking the explicit close button', () => {
    render(<SystemStatusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /all systems operational/i }));

    const closeButton = screen.getByRole('button', { name: 'Close system status' });
    fireEvent.click(closeButton);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
