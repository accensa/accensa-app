'use client';

import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  playSoundEffect,
  setSoundEffectsEnabled,
  soundEffectsEnabled,
} from '@/lib/audio/soundEffects';

export function SoundToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Avoid a server/client mismatch when a stored preference enables sounds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(soundEffectsEnabled());
  }, []);

  function toggle() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    setSoundEffectsEnabled(nextEnabled);
    if (nextEnabled) playSoundEffect('click');
  }

  const label = enabled ? 'Mute checkout sounds' : 'Enable checkout sounds';
  const Icon = enabled ? Volume2 : VolumeX;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      onClick={toggle}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
