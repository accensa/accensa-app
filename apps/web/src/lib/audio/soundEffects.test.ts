/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playSoundEffect,
  resetAudioForTests,
  setSoundEffectsEnabled,
  soundEffectsEnabled,
} from './soundEffects';

describe('checkout sound effects', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAudioForTests();
  });

  it('defaults to muted when reduced motion is preferred, unless explicitly enabled', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(soundEffectsEnabled()).toBe(false);
    setSoundEffectsEnabled(true);
    expect(soundEffectsEnabled()).toBe(true);
    setSoundEffectsEnabled(false);
    expect(soundEffectsEnabled()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('does not construct an audio context while muted', () => {
    const audioContextConstructor = vi.fn();
    vi.stubGlobal('AudioContext', audioContextConstructor);
    setSoundEffectsEnabled(false);

    playSoundEffect('success');

    expect(audioContextConstructor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('schedules audio without returning work for the payment thread to await', () => {
    const oscillator = {
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      type: 'sine',
    };
    const gain = {
      connect: vi.fn(),
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    };
    const context = {
      state: 'running',
      currentTime: 1,
      destination: {},
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );
    setSoundEffectsEnabled(true);

    const result = playSoundEffect('click');

    expect(result).toBeUndefined();
    expect(context.createOscillator).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
