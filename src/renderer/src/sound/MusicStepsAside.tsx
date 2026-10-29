import { EVEN_LOUDNESS_LUFS } from '../../../shared/sound';
import { Toggle } from '../ui/Toggle';
import { setStepsAside, useSound } from './sound-store';

/*
 * Audio's Music steps aside switch (Session 55, Part 7, K; shared/sound.ts): on (the default), the music (a sound, or
 * an audio playlist's track) fades down over about a second under a video with sound, or a slide's or a deck's own
 * sound playing over it (the owner's answer of 30 Oct), never stopping, and back up when that ends or is cleared; off,
 * it plays on as loud as it was.
 */
export function MusicStepsAside() {
  const view = useSound((s) => s.view);
  return (
    <div className="space-y-1 px-3 py-2.5" data-testid="music-steps-aside">
      <Toggle
        checked={view?.stepsAside ?? true}
        disabled={view === null}
        onChange={(on) => void setStepsAside(on)}
        label="Music steps aside for a video"
        data-testid="music-steps-aside-switch"
      />
      <p className="text-xs text-muted">
        Under a video with sound, or a slide’s or a deck’s own sound, the music fades down, never stopping,
        and comes back as that ends.
      </p>
      {/* Even loudness (L), said where the sound is: the level chosen, and the way to play one file as it is. */}
      <p className="text-xs text-muted" data-testid="even-loudness-note">
        Every video and sound plays at an even loudness (−{Math.abs(EVEN_LOUDNESS_LUFS)} LUFS, as streaming
        services play); right-click one to play it as it is.
      </p>
    </div>
  );
}
