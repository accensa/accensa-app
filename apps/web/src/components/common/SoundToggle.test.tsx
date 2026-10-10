/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundToggle } from './SoundToggle';

vi.mock('@/lib/audio/soundEffects', () => ({
  playSoundEffect: vi.fn(),
  setSoundEffectsEnabled: vi.fn(),
  soundEffectsEnabled: vi.fn(() => false),
}));

import { playSoundEffect, setSoundEffectsEnabled } from '@/lib/audio/soundEffects';

describe('SoundToggle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the current state and persists explicit user preference', () => {
    render(<SoundToggle />);
    const toggle = screen.getByRole('button', { name: 'Enable checkout sounds' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(setSoundEffectsEnabled).toHaveBeenCalledWith(true);
    expect(playSoundEffect).toHaveBeenCalledWith('click');
    expect(screen.getByRole('button', { name: 'Mute checkout sounds' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
