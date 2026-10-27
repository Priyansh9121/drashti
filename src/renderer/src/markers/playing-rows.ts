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
  /** Which it is, as a page names it for tests: its layer, or "slide:<media id>" for a slide's video. */
  which: string;
  /**
   * Its React key: this playing of this file, its layer, its file and when it started (an audio playlist's track by
   * its place in the list), so another file, another showing of it or the next track is a row drawn anew, and a drag
   * held on the one that went is let go of, never landing on the one that came (Session 54's review). A move, Pause or
   * Play (a jump) keeps it.
   */
  key: string;
  /** Its short name beside the bar: "Background", "Slide video", "Box video", "Sound", "Music". */
  short: string;
  /**
   * Its name for screen readers, the row's and its bar's: "Time of the background video". Never the name of the row of
   * skips and markers beside it (LIVE's "The background video", Session 50; a phone's, D5), so the two are told apart.
   */
  name: string;
}

/** The rows for everything playing now, in playingNow's order; a slide's second video is "Slide video 2". */
export function playingRows(state: EngineState | null | undefined): PlayingRow[] {
  const all = playingNow(state);
  const onSlide = all.filter((p) => p.ref.layer === 'slide' && !p.sound).length;
  // A deck's sounds on the slide (Session 54, C2): "Slide sound", "Time of the sound on the slide".
  const sounds = all.filter((p) => p.ref.layer === 'slide' && p.sound).length;
  let nth = 0;
  let nthSound = 0;
  return all.map((playing) => {
    const ref = playing.ref;
    const which = ref.layer === 'slide' ? `slide:${ref.mediaId}` : ref.layer;
    const music = playing.track ? state?.layers.audio?.music : undefined;
    const key = music
      ? `music:${music.playlistId}#${String(music.index)}:${playing.mediaId}`
      : `${ref.layer}:${playing.mediaId}@${String(playing.clock.startedAt)}`;
    const named = { playing, which, key };
    switch (ref.layer) {
      case 'background':
        return { ...named, short: 'Background', name: 'Time of the background video' };
      case 'slide': {
        if (playing.sound) {
          nthSound++;
          const soundNumber = sounds > 1 ? ` ${String(nthSound)}` : '';
          return {
            ...named,
            short: `Slide sound${soundNumber}`,
            name:
              sounds > 1
                ? `Time of sound ${String(nthSound)} on the slide`
                : 'Time of the sound on the slide',
          };
        }
        nth++;
        const number = onSlide > 1 ? ` ${String(nth)}` : '';
        return {
          ...named,
          short: `Slide video${number}`,
          name: onSlide > 1 ? `Time of video ${String(nth)} on the slide` : 'Time of the video on the slide',
        };
      }
      case 'pip':
        return { ...named, short: 'Box video', name: 'Time of the video in the picture-in-picture box' };
      case 'audio':
        return playing.track
          ? { ...named, short: 'Music', name: 'Time of the music playing' }
          : { ...named, short: 'Sound', name: 'Time of the sound playing' };
      default:
        return { ...named, short: 'Video', name: 'Time of the video playing' };
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
