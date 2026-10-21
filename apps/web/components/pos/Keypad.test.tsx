// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Keypad from './Keypad';

describe('Keypad', () => {
  let onInput: ReturnType<typeof vi.fn>;
  let onClear: ReturnType<typeof vi.fn>;
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onInput = vi.fn();
    onClear = vi.fn();
    onSubmit = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onInput with the pressed digit and not onClear/onSubmit', () => {
    render(<Keypad onInput={onInput} onClear={onClear} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '7' }));

    expect(onInput).toHaveBeenCalledWith('7');
    expect(onClear).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onClear when C is pressed', () => {
    render(<Keypad onInput={onInput} onClear={onClear} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'C' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('calls onSubmit when Pay is pressed', () => {
    render(<Keypad onInput={onInput} onClear={onClear} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pay' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onInput).not.toHaveBeenCalled();
  });

  it('does not throw when navigator.vibrate is undefined', () => {
    const original = window.navigator.vibrate;
    // jsdom does not implement vibrate by default; make that explicit.
    Object.defineProperty(window.navigator, 'vibrate', {
      value: undefined,
      configurable: true,
    });

    render(<Keypad onInput={onInput} onClear={onClear} onSubmit={onSubmit} />);

    expect(() => fireEvent.click(screen.getByRole('button', { name: '3' }))).not.toThrow();
    expect(onInput).toHaveBeenCalledWith('3');

    Object.defineProperty(window.navigator, 'vibrate', {
      value: original,
      configurable: true,
    });
  });

  it('every key is reachable by accessible role/name', () => {
    render(<Keypad onInput={onInput} onClear={onClear} onSubmit={onSubmit} />);

    const expectedKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'Pay'];
    for (const key of expectedKeys) {
      expect(screen.getByRole('button', { name: key })).toBeDefined();
    }
  });
});
