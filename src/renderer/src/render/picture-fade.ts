import { type CorrectionLimits, FADE_PICTURE_LIMITS } from '../../../shared/media';
import { videoFadeProgress, type VideoCrossfade } from '../../../shared/video-cue';
import { slotKey, type SlotLayer } from './background-slots';
import { engineNow } from './clock';
import { fadeClock } from './cue-clock';

/*
 * A crossfade's two pictures, on every page (lead 2's QF-1, the next release; a22-fade-picture). Out of step, they are
 * brought back by speed and not by jumps, by the sound's own numbers (shared/media.ts FADE_PICTURE_LIMITS: up to 8%
 * faster or slower, a jump only past half a second), from the crossfade's state to its end; outside fades nothing
 * changes. A jump freezes a picture until it lands: on CI's two-core Windows (a22-fade-1124-103850-84620) a fade's
 * outgoing picture, its own time running at 0.3 to 0.8 of the clock (its muted sound's stand-in sink, pulled late on a
 * busy thread), was jumped past a quarter of a second, landed 0.1 to 1 s later still behind and was aimed again at once,
 * so the hall's, LIVE's and the stream page's pictures stood still for 0.6 to 4.4 s of each 2 s fade. By speed it moves
 * on throughout, a little behind at most, and no seek's decoding from a keyframe is spent on three pages at once.
 * render/playback.ts's `ease` does it; render/BackgroundMedia.tsx asks for it.
 *
 * And its clock (the owner's QA23-FADE-6, "Try B in parallel (Rec.)"): from its crossfade's state on, a picture's sound
 * is pulled by the page's silent graph, as a cued one's is (crossfadeClock, render/cue-clock.ts fadeClock), so the
 * outgoing one keeps real time and does not fall behind at all; speed, then, only for what is left.
 */

/**
 * Whether a real crossfade is on at `now` (the engine's time): one with a length (a manual Go's pair is 0 ms, a cut)
 * that is not over: from its state (a second before an automatic crossfade's start, QA23-FADE-9; one Go lead before a
 * press's) to its end, and held while it is paused. As the stream's own sound (program/sound.ts, a22-review-fade M1).
 */
export function crossfadeOn(fade: VideoCrossfade | null | undefined, now: number): boolean {
  return !!fade && fade.durationMs > 0 && videoFadeProgress(fade, now) < 1;
}

/**
 * The crossfade a background picture is one of the two of: the outgoing one (its playback, by its key) or the
 * incoming one (its cue). Null for every other picture, and when there is none.
 */
export function crossfadeOf(
  fade: VideoCrossfade | null | undefined,
  slot: { key: string; layer: SlotLayer },
): VideoCrossfade | null {
  if (!fade || slot.layer.kind !== 'media') return null;
  return slot.key === slotKey(fade.from) || slot.layer.cueId === fade.id ? fade : null;
}

/**
 * startPlayback's `ease` for a background picture, given the crossfade it is one of now (read at every check): the
 * fade's limits while that crossfade is on. Only for a picture already playing or prepared as its crossfade came: one
 * made inside it (its page opened, or started again, part-way through) is put in place as ever, by a jump, as the
 * stream's sound is (a22-review-x86 E5: 0.3 s off at 8% would outlast the fade); in a later crossfade it is eased too.
 */
export function pictureEase(
  fade: () => VideoCrossfade | null,
  now: () => number = engineNow,
): () => CorrectionLimits | null {
  const first = fade();
  const madeIn = first && crossfadeOn(first, now()) ? first.id : null;
  return () => {
    const pair = fade();
    return pair && pair.id !== madeIn && crossfadeOn(pair, now()) ? FADE_PICTURE_LIMITS : null;
  };
}

/**
 * A picture's clock in its crossfade (the owner's QA23-FADE-6, B): `pair()` as the crossfade it is one of changes; once
 * a real one is on (crossfadeOn: never a manual Go's cut, never outside a crossfade), its sound is taken into the page's
 * silent graph (render/cue-clock.ts fadeClock) and stays there until `letGo()`, as the picture is let go (with its
 * crossfade, for the outgoing one). A graph not running then is tried again at the next change of its crossfade.
 */
export interface CrossfadeClock {
  pair(fade: VideoCrossfade | null): void;
  letGo(): void;
}

export function crossfadeClock(
  v: HTMLMediaElement,
  now: () => number = engineNow,
  take: (v: HTMLMediaElement) => (() => void) | null = fadeClock,
): CrossfadeClock {
  let stop: (() => void) | null = null;
  return {
    pair: (fade) => {
      if (stop === null && crossfadeOn(fade, now())) stop = take(v);
    },
    letGo: () => {
      stop?.();
      stop = null;
    },
  };
}
