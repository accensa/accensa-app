// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppError from './error';

const state = vi.hoisted(() => ({ online: true }));

vi.mock('@/components/network-status', () => ({
  useOnline: () => state.online,
}));

function errorWithDigest(digest?: string): Error & { digest?: string } {
  const error = new Error('server boom') as Error & { digest?: string };
  if (digest !== undefined) error.digest = digest;
  return error;
}

describe('AppError', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.online = true;
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('shows the digest reference and logs the error once', () => {
    const error = errorWithDigest('abc123');
    render(<AppError error={error} unstable_retry={vi.fn()} />);

    expect(screen.getByText(/Reference: abc123/)).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(error);
  });

  it('omits the reference when the error has no digest', () => {
    render(<AppError error={errorWithDigest()} unstable_retry={vi.fn()} />);

    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('calls unstable_retry once when Try again is clicked while online', () => {
    const retry = vi.fn();
    render(<AppError error={errorWithDigest()} unstable_retry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the offline copy and disables retry while offline', () => {
    state.online = false;
    const retry = vi.fn();
    render(<AppError error={errorWithDigest()} unstable_retry={retry} />);

    expect(
      screen.getByText(
        /This page hit an error while your browser was offline\. Reconnect and try again/,
      ),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });
});
