import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import { elementVideos, type Playing, type PlayingRef, playingOf } from '../../shared/engine/playing';
import type {
  AbRepeat,
  AudioLayer,
  EngineState,
  Layers,
  VideoFile,
  VideoSeeks,
} from '../../shared/engine/state';
import type { PlaybackMarker } from '../../shared/markers';
import { type PlaybackClip, type PlaybackSeek, playbackAtMs, playbackSpanMs } from '../../shared/media';
import type { EngineAction } from './actions';
import { sameData } from './reducer';

/*
 * The time bar in the engine (Session 54, shared/engine/playing.ts): one move for each kind that plays, kept between
 * its file's start and end points, and Pause and Play. Each is made as a jump to a marker is: the layer's own seek (the
 * background video's, the sound's), or its `seeks` by file (a video on the slide up or in the box; until
 * now only the background and the sound had jumps), from which every screen, node, key and fill, the stream and the
 * audio player play on, or wait, in step. Paused, a move waits where it puts it (as Back 15 s and Forward 15 s move a
 * paused track); Play plays on from there, and from the start point again once played to its end. An audio playlist's
 * track moves as those skips move it (on to the next track at its end) and pauses as Music's Pause does
 * (show-engine.ts). None is a change Back or Put it back undo.
 */

type Refused = Extract<CommandResult, { ok: false }>;
export type PlayingResolved = { ok: true; actions: EngineAction[] } | Refused;
export type PlayingCommand = Extract<
  EngineCommand,
  { type: 'moveTo' | 'pausePlaying' | 'resumePlaying' | 'repeatAb' | 'stopAb' | 'stepFrame' }
>;

/** An A-B repeat's shortest span (ms, alpha.20): shorter, it would only stutter. */
export const AB_SHORTEST_MS = 500;

/** What the engine gives the time bar (show-engine.ts). */
export interface PlayingHooks {
  /** The audio playlist's track ending now: its next track from `at`, or the music's end. */
  nextTrack: (at: number) => EngineAction;
  /** Re-stamp a file whose library points were held when it starts again from the end. */
  refreshRestart: (playing: Playing) => EngineState | null;
}

/** What the library says of a file (show-engine.ts EngineOptions mediaLength and mediaMarkers). */
export interface FileLookups {
  lengthOf: (mediaId: string) => number | null;
  marksOf: (mediaId: string, layer: 'slide' | 'pip') => PlaybackMarker[] | undefined;
}

const NO_CHANGE: PlayingResolved = { ok: true, actions: [] };

const NOT_PLAYING: Record<PlayingRef['layer'], string> = {
  background: 'No video is playing as the background.',
  audio: 'No sound is playing.',
  slide: 'That video is not on the slide up any more.',
  pip: 'No video is in the picture-in-picture box.',
};

const NO_LENGTH: Refused = {
  ok: false,
  error: 'no-length',
  message: 'Its length is not known yet: try again in a moment, once it has started playing.',
};

const AB_NOT_HERE: Refused = {
  ok: false,
  error: 'invalid-command',
  message: 'A-B repeat is for the background video and the sound: use it on one of those.',
};

const AB_TOO_SHORT: Refused = {
  ok: false,
  error: 'invalid-command',
  message: 'A and B are too close together: choose them at least half a second apart.',
};

const NOT_AB: Refused = {
  ok: false,
  error: 'not-repeating',
  message: 'It is not repeating A-B: there is nothing to stop.',
};

const FRAMES_OF_VIDEOS: Refused = {
  ok: false,
  error: 'invalid-command',
  message: 'One frame back and on are for a video: use them on a video that is playing.',
};

const FRAMES_WHILE_PAUSED: Refused = {
  ok: false,
  error: 'invalid-command',
  message: 'Pause it first: a frame is stepped while it waits.',
};

/**
 * The background video's or the sound's layer going round between new points, or back to its own (A-B repeat,
 * alpha.20): its points (none: the whole file), whether it goes round, what it keeps aside, and where it plays from
 * (`toMs` into its file): a jump as a marker's (waiting there when paused); an audio playlist's track paused by Music's
 * Pause waits there by how far it is past its start point, as Music's Pause keeps it, with no jump.
 */
function withRepeat(
  state: EngineState,
  playing: Playing,
  next: { clip: PlaybackClip | undefined; loop: boolean; ab: AbRepeat | undefined; toMs: number },
  now: number,
): EngineAction | null {
  const shaped = <T extends { clip?: PlaybackClip; loop: boolean; seek?: PlaybackSeek; ab?: AbRepeat }>(
    layer: T,
    seek: PlaybackSeek | undefined,
  ): T => {
    const out: T = { ...layer, loop: next.loop };
    if (next.clip) out.clip = next.clip;
    else delete out.clip;
    if (next.ab) out.ab = next.ab;
    else delete out.ab;
    if (seek) out.seek = seek;
    else delete out.seek;
    return out;
  };
  const jump = (paused: boolean): PlaybackSeek => ({
    at: now,
    toMs: next.toMs,
    ...(paused ? { paused: true } : {}),
  });
  const { layers } = state;
  if (playing.ref.layer === 'background') {
    const bg = layers.background;
    if (bg?.kind !== 'media') return null;
    return { type: 'background/set', background: shaped(bg, jump(bg.seek?.paused === true)) };
  }
  const a = layers.audio;
  if (playing.ref.layer !== 'audio' || !a) return null;
  if (a.pausedAtMs !== undefined)
    return {
      type: 'audio/set',
      audio: { ...shaped(a, undefined), pausedAtMs: Math.max(0, next.toMs - (next.clip?.startMs ?? 0)) },
    };
  return { type: 'audio/set', audio: shaped(a, jump(a.seek?.paused === true)) };
}

/** The layer's own points and loop, as kept aside by an A-B repeat or as they are. */
function ownOf(state: EngineState, playing: Playing): AbRepeat {
  const layer =
    playing.ref.layer === 'background'
      ? state.layers.background?.kind === 'media'
        ? state.layers.background
        : null
      : state.layers.audio;
  if (layer?.ab) return layer.ab;
  return { ...(playing.clock.clip ? { clip: playing.clock.clip } : {}), loop: playing.clock.loop };
}

/** The layer with this jump for what plays: the background's and the sound's own, the rest by file. */
function withSeek(state: EngineState, playing: Playing, seek: PlaybackSeek): EngineAction | null {
  const by = (seeks: VideoSeeks | undefined): VideoSeeks => ({ ...seeks, [playing.mediaId]: seek });
  const { layers } = state;
  const ref = playing.ref;
  switch (ref.layer) {
    case 'background': {
      const bg = layers.background;
      return bg?.kind === 'media' ? { type: 'background/set', background: { ...bg, seek } } : null;
    }
    case 'audio':
      return layers.audio ? { type: 'audio/set', audio: { ...layers.audio, seek } } : null;
    case 'slide':
      return layers.slide
        ? { type: 'slide/put', layer: { ...layers.slide, seeks: by(layers.slide.seeks) } }
        : null;
    case 'pip':
      // Its time, its place and a swap running kept, as new points keep them (Session 53).
      return layers.pip ? { type: 'pip/set', layer: { ...layers.pip, seeks: by(layers.pip.seeks) } } : null;
  }
}

/**
 * An audio playlist's track moved to `toMs` (between its points), as Back 15 s and Forward 15 s move it (show-engine.ts
 * skip): at its end, on to the next track, as at any end (paused, the next waits at its start; the last waits at its
 * end, and Play then ends the music); paused, it waits at its new point.
 */
function moveTrack(
  a: AudioLayer,
  toMs: number,
  span: { start: number; end: number },
  now: number,
  hooks: PlayingHooks,
): PlayingResolved {
  if (toMs >= span.end) {
    const next = hooks.nextTrack(now);
    if (a.pausedAtMs === undefined) return { ok: true, actions: [next] };
    if (next.type === 'audio/set')
      return { ok: true, actions: [{ type: 'audio/set', audio: { ...next.audio, pausedAtMs: 0 } }] };
  }
  if (a.pausedAtMs !== undefined) {
    const pausedAtMs = toMs - span.start;
    return pausedAtMs === a.pausedAtMs
      ? NO_CHANGE
      : { ok: true, actions: [{ type: 'audio/set', audio: { ...a, pausedAtMs } }] };
  }
  return { ok: true, actions: [{ type: 'audio/set', audio: { ...a, seek: { at: now, toMs } } }] };
}

/**
 * The time bar's move, Pause or Play at `now`. An audio playlist's track's Pause and Play are Music's own
 * (show-engine.ts sends them there); its move is here.
 */
export function resolvePlaying(
  state: EngineState,
  command: PlayingCommand,
  now: number,
  hooks: PlayingHooks,
): PlayingResolved {
  const playing = playingOf(state, command.playing);
  if (!playing) return { ok: false, error: 'nothing-playing', message: NOT_PLAYING[command.playing.layer] };
  const length = playing.durationMs;
  // Without its length there is no end to keep to, nor a place in a loop (a screen says it a moment after it starts).
  if (length === undefined || length <= 0) return NO_LENGTH;
  const { clock } = playing;
  const span = playbackSpanMs(clock.clip, length);
  const atMs = playbackAtMs(clock, length, now);
  const put = (seek: PlaybackSeek, target = state): PlayingResolved => {
    const action = withSeek(target, playing, seek);
    return action ? { ok: true, actions: [action] } : NO_CHANGE;
  };
  const paused = clock.seek?.paused === true;
  const waiting = paused || clock.pausedAtMs !== undefined;
  switch (command.type) {
    case 'repeatAb': {
      if (command.playing.layer !== 'background' && command.playing.layer !== 'audio') return AB_NOT_HERE;
      // Kept between its own points (as they were before any A-B), B before A swapped.
      const own = ownOf(state, playing);
      const room = playbackSpanMs(own.clip, length);
      const keep = (ms: number) => Math.min(room.end, Math.max(room.start, ms));
      const [a, b] = [keep(command.fromMs), keep(command.toMs)].sort((x, y) => x - y) as [number, number];
      if (b - a < AB_SHORTEST_MS) return AB_TOO_SHORT;
      const action = withRepeat(
        state,
        playing,
        { clip: { startMs: a, endMs: b }, loop: true, ab: own, toMs: a },
        now,
      );
      return action ? { ok: true, actions: [action] } : NO_CHANGE;
    }
    case 'stopAb': {
      const layer =
        command.playing.layer === 'background'
          ? state.layers.background?.kind === 'media'
            ? state.layers.background
            : null
          : command.playing.layer === 'audio'
            ? state.layers.audio
            : null;
      const own = layer?.ab;
      if (!own) return NOT_AB;
      // Plays on from where it is, between its own points again (kept to them), once only or going round as before.
      const back = playbackSpanMs(own.clip, length);
      const toMs = Math.min(back.end, Math.max(back.start, atMs));
      const action = withRepeat(state, playing, { clip: own.clip, loop: own.loop, ab: undefined, toMs }, now);
      return action ? { ok: true, actions: [action] } : NO_CHANGE;
    }
    case 'stepFrame': {
      if (command.playing.layer === 'audio' || playing.sound === true) return FRAMES_OF_VIDEOS;
      if (!waiting) return FRAMES_WHILE_PAUSED;
      // The frame it shows, then the middle of the one before or after it, kept between its points.
      const frame = Math.floor((atMs + 0.5) / command.frameMs);
      const middle = Math.round((frame + command.by + 0.5) * command.frameMs);
      const toMs = Math.min(span.end, Math.max(span.start, middle));
      return toMs === atMs ? NO_CHANGE : put({ at: now, toMs, paused: true });
    }
    case 'moveTo': {
      const toMs = Math.min(span.end, Math.max(span.start, command.toMs));
      const track = state.layers.audio;
      if (playing.track && track) return moveTrack(track, toMs, span, now, hooks);
      if (paused && toMs === atMs) return NO_CHANGE;
      return put({ at: now, toMs, ...(paused ? { paused: true } : {}) });
    }
    case 'pausePlaying':
      return paused ? NO_CHANGE : put({ at: now, toMs: atMs, paused: true });
    case 'resumePlaying': {
      // Played once to its end point (held there, or paused there): Play plays it again from its start point.
      const ended = !clock.loop && atMs >= span.end;
      if (!paused && !ended) return NO_CHANGE;
      const refreshed = ended ? hooks.refreshRestart(playing) : null;
      const start = refreshed
        ? playbackSpanMs(playingOf(refreshed, command.playing)?.clock.clip, length).start
        : span.start;
      return put({ at: now, toMs: ended ? start : atMs }, refreshed ?? state);
    }
  }
}

/**
 * What the time bar shows of each video on the slide up and in the box (Session 54): the length
 * the state has (one a screen has just told, which the library keeps a moment later), else the library's; and its
 * markers used by the current playback. Null when none has either.
 */
export function videoFilesFor(state: EngineState, library: FileLookups): Record<string, VideoFile> | null {
  const files: Record<string, VideoFile> = {};
  const box = state.layers.pip?.source;
  const boxId = box?.kind === 'media' && box.media === 'video' ? box.mediaId : null;
  for (const id of elementVideos(state)) {
    const durationMs = state.videoFiles?.[id]?.durationMs ?? library.lengthOf(id) ?? 0;
    const inBox = id === boxId;
    const onSlide = !inBox || playingOf(state, { layer: 'slide', mediaId: id }) !== null;
    const marks = library.marksOf(id, onSlide ? 'slide' : 'pip') ?? [];
    const boxMarks = inBox && onSlide ? (library.marksOf(id, 'pip') ?? []) : marks;
    if (durationMs > 0 || marks.length > 0 || boxMarks.length > 0)
      files[id] = {
        ...(durationMs > 0 ? { durationMs } : {}),
        ...(marks.length > 0 ? { marks } : {}),
        ...(!sameData(marks, boxMarks) ? { boxMarks } : {}),
      };
  }
  return Object.keys(files).length > 0 ? files : null;
}

/**
 * The videoFiles with a length a screen has just told (Session 54); null when no video on the slide up or in the box
 * plays that file, or the state has that length already.
 */
export function learnedFiles(
  state: EngineState,
  mediaId: string,
  durationMs: number,
): Record<string, VideoFile> | null {
  if (!elementVideos(state).includes(mediaId)) return null;
  const was = state.videoFiles?.[mediaId];
  return was?.durationMs === durationMs ? null : { ...state.videoFiles, [mediaId]: { ...was, durationMs } };
}

/** A file's start and end points and markers, as the library has them (show-engine.ts withPoints). */
interface Points {
  clip?: PlaybackClip;
  marks?: PlaybackMarker[];
}

/**
 * Going round from A to B (alpha.20): the library's points as they are now wait aside, with the loop, for Stop to put
 * back, and its markers show at once; A and B stay.
 */
export function pointsAside<T extends Points>(layer: T, points: Points): T {
  const was = (layer as T & { ab?: AbRepeat }).ab;
  if (!was) return layer;
  const ab: AbRepeat = { ...(points.clip ? { clip: points.clip } : {}), loop: was.loop };
  if (sameData(was, ab) && sameData(layer.marks, points.marks)) return layer;
  const out: T & { ab?: AbRepeat } = { ...layer, ab };
  if (points.marks) out.marks = points.marks;
  else delete out.marks;
  return out;
}

/**
 * A file that plays on as it did (the same file, from the same start) keeps its A-B repeat as it is now (alpha.20):
 * Back and Put it back move the slides, never what goes round, as they keep its jumps. Only where either has one.
 */
export function keepRepeat<
  T extends { mediaId: string | null; startedAt: number; clip?: PlaybackClip; loop: boolean; ab?: AbRepeat },
>(was: T, is: T | null): T {
  if (!is || is.mediaId !== was.mediaId || is.startedAt !== was.startedAt) return was;
  if (!was.ab && !is.ab) return was;
  if (sameData(was.ab, is.ab) && sameData(was.clip, is.clip) && was.loop === is.loop) return was;
  const out: T = { ...was, loop: is.loop };
  if (is.clip) out.clip = is.clip;
  else delete out.clip;
  if (is.ab) out.ab = is.ab;
  else delete out.ab;
  return out;
}

/** A layer with these moves (none: left out). */
function withSeeks<T extends { seeks?: VideoSeeks }>(layer: T, seeks: VideoSeeks | undefined): T {
  const { seeks: _then, ...rest } = layer;
  return (seeks ? { ...rest, seeks } : rest) as T;
}

/**
 * Layers as they were (Back), the box still up as it was then (the same one, from the same time)
 * keeping where the time bar has moved or paused its videos since (Session 54), as a background's and the sound's
 * jumps are kept: undoing a Next moves the slides, not what plays. The same layers when nothing moved.
 */
export function keepMoves(was: Layers, now: Layers): Layers {
  const box = was.pip;
  const boxNow = now.pip;
  const boxMoved =
    box !== null &&
    boxNow?.shownAt === box.shownAt &&
    sameData(box.source, boxNow.source) &&
    !sameData(box.seeks, boxNow.seeks);
  const pip = boxMoved ? withSeeks(box, boxNow.seeks) : box;
  return pip === box ? was : { ...was, pip };
}
