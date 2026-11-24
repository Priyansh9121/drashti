import { type CorrectionLimits, FADE_PICTURE_LIMITS } from '../../../shared/media';
import { videoFadeProgress, type VideoCrossfade } from '../../../shared/video-cue';
import { slotKey, type SlotLayer } from './background-slots';
import { engineNow } from './clock';

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
 */

/**
 * Whether a real crossfade is on at `now` (the engine's time): one with a length (a manual Go's pair is 0 ms, a cut)
 * that is not over: from its state, one Go lead before its start, to its end, and held while it is paused. As the
 * stream's own sound (program/sound.ts, a22-review-fade M1).
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

/** A picture's clock in its crossfade (the owner's QA23-FADE-6). Red: never taken. */
export interface CrossfadeClock {
  pair(fade: VideoCrossfade | null): void;
  letGo(): void;
}

export function crossfadeClock(
  _v: HTMLMediaElement,
  _now: () => number = engineNow,
  _take: (v: HTMLMediaElement) => (() => void) | null = () => null,
): CrossfadeClock {
  return { pair: () => undefined, letGo: () => undefined };
}
