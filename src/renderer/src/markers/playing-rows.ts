import { type Playing, type PlayingRef, playingNow } from '../../../shared/engine/playing';
import type { EngineState } from '../../../shared/engine/state';
import { playbackAtMs, playbackSpanMs } from '../../../shared/media';

/*
 * The time bar's rows (Session 54), for LIVE, Music and a phone alike: what each thing playing is called, and where it
 * is at a moment, from the engine's state and time, as every screen has it (shared/media.ts playbackAtMs).
 */

/** One thing playing, as a row of the time bar shows it. */
export interface PlayingRow {
  playing: Playing;
  /** A stable key: its layer, and its file for a slide's video. */
  key: string;
  /** Its short name beside the bar: "Background", "Slide video", "Box video", "Sound", "Music". */
  short: string;
  /** Its name for screen readers, the row's: "The background video". */
  name: string;
}

/** The rows for everything playing now, in playingNow's order; a slide's second video is "Slide video 2". */
export function playingRows(state: EngineState | null | undefined): PlayingRow[] {
  const all = playingNow(state);
  const onSlide = all.filter((p) => p.ref.layer === 'slide').length;
  let nth = 0;
  return all.map((playing) => {
    const ref = playing.ref;
    const key = ref.layer === 'slide' ? `slide:${ref.mediaId}` : ref.layer;
    switch (ref.layer) {
      case 'background':
        return { playing, key, short: 'Background', name: 'The background video' };
      case 'slide': {
        nth++;
        const which = onSlide > 1 ? ` ${String(nth)}` : '';
        return {
          playing,
          key,
          short: `Slide video${which}`,
          name: onSlide > 1 ? `Video ${String(nth)} on the slide` : 'The video on the slide',
        };
      }
      case 'pip':
        return { playing, key, short: 'Box video', name: 'The video in the picture-in-picture box' };
      case 'audio':
        return playing.track
          ? { playing, key, short: 'Music', name: 'The music playing' }
          : { playing, key, short: 'Sound', name: 'The sound playing' };
      default:
        return { playing, key, short: 'Video', name: 'The video playing' };
    }
  });
}

/** What the bar draws of one thing playing at `now`. */
export interface BarNow {
  /** Where it is (ms into its file). */
  atMs: number;
  /** Its file's length, or null while not known. */
  durationMs: number | null;
  startMs: number;
  endMs: number | null;
  /** Played once to its end point and held there: Play plays it from its start point again. */
  ended: boolean;
}

/** Where it is at `now` (the engine's time), as every screen has it. */
export function barNow(playing: Playing, now: number): BarNow {
  const d = playing.durationMs;
  const startMs = playing.clock.clip?.startMs ?? 0;
  const endMs = playing.clock.clip?.endMs ?? null;
  if (d === undefined || d <= 0) return { atMs: startMs, durationMs: null, startMs, endMs, ended: false };
  const atMs = playbackAtMs(playing.clock, d, now);
  const span = playbackSpanMs(playing.clock.clip, d);
  return {
    atMs,
    durationMs: d,
    startMs,
    endMs,
    ended: !playing.track && !playing.clock.loop && atMs >= span.end,
  };
}

/** The command that moves it, pauses it or plays it on (shared/engine/commands.ts). */
export const moveCommand = (ref: PlayingRef, toMs: number) => ({
  type: 'moveTo' as const,
  playing: ref,
  toMs,
});
export const pauseCommand = (ref: PlayingRef) => ({ type: 'pausePlaying' as const, playing: ref });
export const playCommand = (ref: PlayingRef) => ({ type: 'resumePlaying' as const, playing: ref });
