export type SoundCue = 'click' | 'success' | 'error';

const STORAGE_KEY = 'accensa:checkout-sounds';

let audioContext: AudioContext | null = null;

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function soundEffectsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const preference = window.localStorage.getItem(STORAGE_KEY);
    if (preference === 'enabled') return true;
    if (preference === 'disabled') return false;
  } catch {
    return false;
  }
  return !reducedMotionPreferred();
}

export function setSoundEffectsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'enabled' : 'disabled');
  } catch {
    // A storage restriction should not interfere with checkout feedback.
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return null;
  audioContext ??= new AudioContextConstructor();
  if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
  return audioContext;
}

const CUES: Record<SoundCue, { notes: number[]; duration: number; type: OscillatorType }> = {
  click: { notes: [660], duration: 0.055, type: 'sine' },
  success: { notes: [523.25, 659.25, 783.99], duration: 0.2, type: 'triangle' },
  error: { notes: [330, 261.63], duration: 0.12, type: 'sine' },
};

/** Schedules a brief synthesized cue; it never returns a promise or delays payment work. */
export function playSoundEffect(cue: SoundCue): void {
  if (!soundEffectsEnabled()) return;
  try {
    const context = getAudioContext();
    if (!context) return;
    const { notes, duration, type } = CUES[cue];
    const startAt = context.currentTime;
    const spacing = cue === 'success' ? 0.075 : 0.045;

    for (const [index, frequency] of notes.entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = startAt + index * spacing;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    }
  } catch {
    // Audio is optional and must never interfere with the payment callback.
  }
}

export function resetAudioForTests(): void {
  audioContext = null;
}
