import { z } from 'zod';
import type { PlaybackMarker } from '../markers';
import type { PlaybackClock } from '../media';
import type { SlideElement } from '../model';
import { idSchema } from '../model-schema';
import { deckMediaOf } from '../deck-show';
import { type EngineState, type VideoClips, videoClip, type VideoSeeks, videoSeek } from './state';

/*
 * The time bar (Session 54): what plays now, which the bar under LIVE, Music's and a phone's show, move, pause and
 * play on, named the same way by the operator window, a phone and the engine: the background video, the sound (an
 * audio playlist's track too), or a video on the slide up, a prop, the logo or in the picture-in-picture box, by its
 * file. How each plays (from when, looping or not, between which points, and where it was last moved to, paused or
 * not) is the engine's state, so every screen, node and phone works out where it is from the engine's time
 * (shared/media.ts playbackAtMs), and a move or a pause lands in step everywhere, as a jump to a marker does.
 */

/** What plays, as a command names it (shared/engine/commands.ts: moveTo, pausePlaying, resumePlaying). */
export const playingSchema = z.discriminatedUnion('layer', [
  z.object({ layer: z.literal('background') }),
  z.object({ layer: z.literal('audio') }),
  z.object({ layer: z.literal('slide'), mediaId: idSchema }),
  z.object({ layer: z.literal('props'), propId: idSchema, mediaId: idSchema }),
  z.object({ layer: z.literal('logo'), mediaId: idSchema }),
  z.object({ layer: z.literal('pip') }),
]);

export type PlayingRef = z.infer<typeof playingSchema>;

/** One thing playing, as the time bar has it. */
export interface Playing {
  ref: PlayingRef;
  mediaId: string;
  /** How it plays: from when, looping or not, between which points, and where it was last moved to (paused or not). */
  clock: PlaybackClock & { pausedAtMs?: number };
  /** Its file's length (ms) once a screen has said; undefined until then: the bar waits, and nothing moves it. */
  durationMs: number | undefined;
  /** Its file's markers: ticks on the bar. */
  marks: readonly PlaybackMarker[];
  /** An audio playlist's track (Session 14): Pause and Play pause and play it on as Music's own buttons do. */
  track: boolean;
  /** Paused: by the time bar's Pause (its seek's `paused`), or a track by Music's (`pausedAtMs`). */
  paused: boolean;
  /** A deck's sound on the slide up (Session 54, C2), not a video. */
  sound?: boolean;
}

const NO_MARKS: readonly PlaybackMarker[] = [];

/** The first video of this file among a slide's, a prop's or the logo's elements; undefined when there is none. */
function videoOf(elements: readonly SlideElement[], mediaId: string): SlideElement | undefined {
  return elements.find((e) => e.kind === 'video' && e.mediaId === mediaId);
}

/**
 * A video of a slide, a prop, the logo or the box, by its file: playing from when it went up (`shownAt`; a prop saved
 * before Session 27 has none, and plays from when each screen drew it, so no move could land in step: none), between
 * its layer's points, from its layer's last move.
 */
function videoPlaying(
  state: EngineState,
  ref: PlayingRef,
  mediaId: string,
  shownAt: number | undefined,
  loop: boolean,
  clips: VideoClips | undefined,
  seeks: VideoSeeks | undefined,
): Playing | null {
  if (shownAt === undefined) return null;
  const file = state.videoFiles?.[mediaId];
  const clip = videoClip(clips, mediaId);
  const seek = videoSeek(seeks, mediaId);
  return {
    ref,
    mediaId,
    clock: { startedAt: shownAt, loop, ...(clip ? { clip } : {}), ...(seek ? { seek } : {}) },
    durationMs: file?.durationMs,
    marks: file?.marks ?? NO_MARKS,
    track: false,
    paused: seek?.paused === true,
  };
}

/** What a reference names as it plays now, or null when nothing of it plays (gone, a picture, no such video). */
export function playingOf(state: EngineState | null | undefined, ref: PlayingRef): Playing | null {
  if (!state) return null;
  const layers = state.layers;
  switch (ref.layer) {
    case 'background': {
      const bg = layers.background;
      if (bg?.kind !== 'media' || bg.media !== 'video') return null;
      return {
        ref,
        mediaId: bg.mediaId,
        clock: bg,
        durationMs: bg.durationMs,
        marks: bg.marks ?? NO_MARKS,
        track: false,
        paused: bg.seek?.paused === true,
      };
    }
    case 'audio': {
      const a = layers.audio;
      if (!a?.mediaId) return null;
      const track = a.music !== undefined;
      return {
        ref,
        mediaId: a.mediaId,
        clock: a,
        durationMs: a.durationMs,
        marks: a.marks ?? NO_MARKS,
        track,
        paused: track ? a.pausedAtMs !== undefined : a.seek?.paused === true,
      };
    }
    case 'slide': {
      const slide = layers.slide;
      const el = slide ? videoOf(slide.slide.elements, ref.mediaId) : undefined;
      // A deck's own video goes round as its deck says, and a deck's sound has a bar too (Session 54, C2).
      const own = slide ? deckMediaOf(slide.slide, ref.mediaId) : undefined;
      const sound = el === undefined && own?.kind === 'audio';
      if (!slide || (el?.kind !== 'video' && !sound)) return null;
      const loop = own ? own.loop : el?.kind === 'video' ? (el.loop ?? false) : false;
      const found = videoPlaying(state, ref, ref.mediaId, slide.shownAt, loop, slide.clips, slide.seeks);
      return found && sound ? { ...found, sound } : found;
    }
    case 'props': {
      const prop = layers.props.find((p) => p.id === ref.propId);
      const el = prop ? videoOf(prop.elements, ref.mediaId) : undefined;
      if (!prop || el?.kind !== 'video') return null;
      return videoPlaying(state, ref, ref.mediaId, prop.shownAt, el.loop ?? false, prop.clips, prop.seeks);
    }
    case 'logo': {
      const logo = state.logo;
      const el = logo ? videoOf(logo.elements, ref.mediaId) : undefined;
      if (!logo || el?.kind !== 'video') return null;
      return videoPlaying(state, ref, ref.mediaId, logo.shownAt, el.loop ?? false, logo.clips, logo.seeks);
    }
    case 'pip': {
      const box = layers.pip;
      if (box?.source.kind !== 'media' || box.source.media !== 'video') return null;
      // A video in the box always goes round (Session 50).
      return videoPlaying(state, ref, box.source.mediaId, box.shownAt, true, box.clips, box.seeks);
    }
  }
}

/**
 * Everything playing, each with its time bar under LIVE and on a phone, in this order: the background video, the
 * slide's videos (each file once, a deck's too), each prop's videos (each file once a prop) and the logo's (Session
 * 54, the owner's answer of 28 Oct: every video has a bar), the picture-in-picture box's video, and the sound or an
 * audio playlist's track.
 */
export function playingNow(state: EngineState | null | undefined): Playing[] {
  if (!state) return [];
  const refs: PlayingRef[] = [{ layer: 'background' }];
  const seen = new Set<string>();
  for (const el of state.layers.slide?.slide.elements ?? []) {
    if (el.kind !== 'video' || seen.has(el.mediaId)) continue;
    seen.add(el.mediaId);
    refs.push({ layer: 'slide', mediaId: el.mediaId });
  }
  // A deck's sounds on the slide up (Session 54, C2), each once, after its videos.
  for (const m of state.layers.slide?.slide.deck?.media ?? []) {
    if (m.kind !== 'audio' || seen.has(m.mediaId)) continue;
    seen.add(m.mediaId);
    refs.push({ layer: 'slide', mediaId: m.mediaId });
  }
  for (const prop of state.layers.props) {
    const own = new Set<string>();
    for (const el of prop.elements) {
      if (el.kind !== 'video' || own.has(el.mediaId)) continue;
      own.add(el.mediaId);
      refs.push({ layer: 'props', propId: prop.id, mediaId: el.mediaId });
    }
  }
  const logo = new Set<string>();
  for (const el of state.logo?.elements ?? []) {
    if (el.kind !== 'video' || logo.has(el.mediaId)) continue;
    logo.add(el.mediaId);
    refs.push({ layer: 'logo', mediaId: el.mediaId });
  }
  refs.push({ layer: 'pip' }, { layer: 'audio' });
  return refs.flatMap((ref) => playingOf(state, ref) ?? []);
}

/** The files of the videos on the slide up, the props, the logo and in the box (Session 54), each once. */
export function elementVideos(state: Pick<EngineState, 'layers' | 'logo'>): string[] {
  const ids = new Set<string>();
  const add = (elements: readonly SlideElement[]) => {
    for (const el of elements) if (el.kind === 'video') ids.add(el.mediaId);
  };
  add(state.layers.slide?.slide.elements ?? []);
  // A deck's sounds on the slide up (Session 54, C2): the time bar shows their length and markers too.
  for (const m of state.layers.slide?.slide.deck?.media ?? []) if (m.kind === 'audio') ids.add(m.mediaId);
  for (const prop of state.layers.props) add(prop.elements);
  add(state.logo?.elements ?? []);
  const box = state.layers.pip?.source;
  if (box?.kind === 'media' && box.media === 'video') ids.add(box.mediaId);
  return [...ids];
}
