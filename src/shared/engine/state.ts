import type { CalendarDay, CalendarLang } from '../calendar';
import type { IdleState, Quote } from '../idle';
import { NO_IDLE } from '../idle';
import type { LiveLook } from '../looks';
import type { Mask } from '../masks';
import { NO_LOOK } from '../looks';
import type { RenderSlide, SlideElement, Transition } from '../model';
import type { TimerState } from '../timers';

/**
 * Show engine state. The main process owns it; every renderer (and, later,
 * every remote Drashti Node) holds a copy that it keeps in sync from
 * snapshots and patches. It must stay plain, JSON-serializable data.
 *
 * Bump ENGINE_STATE_VERSION whenever the shape changes incompatibly.
 */
export const ENGINE_STATE_VERSION = 8;

export type LayerName = 'audio' | 'background' | 'slide' | 'props' | 'messages' | 'ticker' | 'masks';

/** Bottom to top, the order outputs composite visible layers in. Audio has no picture. */
export const LAYER_NAMES = [
  'audio',
  'background',
  'slide',
  'props',
  'messages',
  'ticker',
  'masks',
] as const satisfies readonly LayerName[];

/** A playlist item being played. */
export interface PlaylistCursor {
  playlistId: string;
  itemId: string;
}

/**
 * Where the operator is: the live presentation and slide, even while the
 * slide layer is cleared, and the playlist item it came from. On a media
 * item there is no presentation, only the item.
 */
export interface LiveCursor {
  presentationId: string | null;
  /** Position in the playing order (an arrangement can show a slide more than once). */
  slideIndex: number | null;
  slideCount: number;
  /** The arrangement being played, or null for every slide in order. */
  arrangementId: string | null;
  /** The playlist item being played, or null when playing from the library. */
  playlist: PlaylistCursor | null;
}

export interface SlideLayer {
  presentationId: string;
  slideIndex: number;
  slide: RenderSlide;
  /**
   * When this slide went live (ms since the epoch, main-process clock):
   * videos placed on it play from here, in step on every window.
   */
  shownAt: number;
  /** The slide's notes, for the stage screen. */
  notes: string;
  /**
   * How it came on: a dissolve from the slide before, from shownAt for its
   * duration (outputs that join later show it finished). Left out for a cut.
   */
  transition?: Transition;
}

/** A sound for the audio layer, as a slide's audio cue or the operator asks for it. */
export interface AudioChoice {
  id: string;
  title: string;
  mediaId: string | null;
  /** 0 to 1. */
  volume: number;
  /** Plays again from the start at the end, until cleared; otherwise plays once. */
  loop: boolean;
}

/** A track of an audio playlist (Session 14). */
export interface MusicTrack {
  mediaId: string;
  title: string;
}

/**
 * The audio layer playing an audio playlist (Session 14): its tracks in the
 * order they play (shuffled when it says so, the same on every window and
 * after a restart), and which one this is. The engine moves on to the next
 * track as one ends (from the track's start time and length, so every
 * window and the audio player agree), and at the end goes round again or
 * stops.
 */
export interface MusicRun {
  playlistId: string;
  name: string;
  tracks: MusicTrack[];
  index: number;
  loop: boolean;
  shuffle: boolean;
}

/**
 * What the audio layer plays. It stays on later slides until something
 * replaces or clears it; the same file on a later slide carries on.
 */
export interface AudioLayer extends AudioChoice {
  /** When it started (ms since the epoch, main-process clock), so the sound stays where it is. */
  startedAt: number;
  /** How long the file is, once known (learned from playing it): a stage screen shows the time left. */
  durationMs?: number;
  /** An audio playlist's track (Session 14): the playlist, and where in it. */
  music?: MusicRun;
  /** Paused this far into the track (ms); left out while it plays. Nothing sounds while paused. */
  pausedAtMs?: number;
}

export type MediaFit = 'fit' | 'fill' | 'stretch';

/** An image or video for the background layer, as a slide cue or the operator asks for it. */
export interface MediaBackground {
  kind: 'media';
  mediaId: string;
  media: 'image' | 'video';
  fit: MediaFit;
  /** A video loops, or plays once and holds its last frame. */
  loop: boolean;
}

/** What a command or cue asks the background layer to show. */
export type BackgroundChoice = { kind: 'color'; color: string } | MediaBackground;

/**
 * What the background layer shows: a colour, or an image or video from the
 * media library. A slide's background cue sets it (PLAN.md 4.3); it stays up
 * on later slides until something replaces or clears it.
 */
export type BackgroundLayer =
  | { kind: 'color'; color: string }
  | (MediaBackground & {
      /**
       * When playback started (ms since the epoch, main-process clock). The
       * same file on a later slide keeps it, so the video carries on instead
       * of restarting; a window that joins late starts from this point.
       */
      startedAt: number;
      /** It came on dissolving from the background before, with its slide: from `at` for `durationMs`. */
      fade?: { at: number; durationMs: number };
      /** A video's length, once known (learned from playing it): a stage screen shows the time left. */
      durationMs?: number;
    });

export interface PropItem {
  id: string;
  name: string;
  elements: SlideElement[];
  /** The canvas its elements are placed on (1920 x 1080 when left out); screens scale it as they do slides. */
  width?: number;
  height?: number;
}

/**
 * Part of a message: words, a timer shown live (each window works out its
 * time), or today's Samvat date and tithi from the loaded calendars (nothing
 * when they do not give today).
 */
export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'timer'; timerId: string }
  | { kind: 'samvat'; lang: CalendarLang };

export interface MessageItem {
  id: string;
  /** The message as plain text (a timer as its name in brackets). */
  text: string;
  /** When given, what is drawn: its words and live timers. */
  parts?: MessagePart[];
}

/** An announcement in the ticker. */
export interface TickerItem {
  id: string;
  text: string;
}

/**
 * Announcements scrolling along the bottom of the audience screens, one
 * after another. Every screen works out where the words are from startedAt
 * (main-process clock), so they scroll in step everywhere; it starts again
 * from the right edge whenever an announcement joins or leaves.
 */
export interface TickerLayer {
  items: TickerItem[];
  startedAt: number;
}

/**
 * The Masks layer: a mask from the library (shared/masks.ts) the operator
 * put up on the audience screens, until it is cleared (F7, Clear all).
 */
export type MaskLayer = Mask;

export interface Layers {
  audio: AudioLayer | null;
  background: BackgroundLayer | null;
  slide: SlideLayer | null;
  props: PropItem[];
  messages: MessageItem[];
  ticker: TickerLayer | null;
  masks: MaskLayer | null;
}

/**
 * What Next will show: the next slide (in this presentation, or the first of
 * the next playlist item) or the next media item. The operator window shows
 * it beside the live picture, and every output loads its images and videos
 * ahead of time.
 */
export type UpNext =
  | {
      kind: 'slide';
      presentationId: string;
      slideIndex: number;
      slide: RenderSlide;
      /** The background its cue puts up, if it has one that can play. */
      background: MediaBackground | null;
      /** The playlist item it starts, when it is in the next item. */
      itemId: string | null;
    }
  | { kind: 'media'; itemId: string; mediaId: string; media: 'image' | 'video' | 'audio'; label: string };

/** One of the playlist's next items, for a stage screen ("coming up"). */
export interface UpcomingItem {
  id: string;
  label: string;
  kind: 'presentation' | 'media' | 'header';
}

/** How many of the playlist's next items the state carries. */
export const UPCOMING_ITEMS = 8;

/**
 * Something put first in line for Next (Session 12: the arti, at its
 * scheduled time): Next plays it, and the previews show it as what comes
 * next. It goes once played, or when the operator says Not now.
 */
export interface CuedNext {
  presentationId: string;
  /** What it is, for the prompt and the previews ("Evening arti"). */
  label: string;
  /** The live playlist's item with that presentation (the show then goes on through the playlist), or null. */
  playlist: PlaylistCursor | null;
}

export interface EngineState {
  version: typeof ENGINE_STATE_VERSION;
  live: LiveCursor;
  layers: Layers;
  /** Output-wide black-out. Independent of the layers, so turning it off restores the picture. */
  blackout: boolean;
  /**
   * The logo on the audience screens instead of the picture (Simple Mode's
   * Logo), or null. Like black-out it covers the layers without clearing
   * them, so taking it down brings back exactly what was there; black-out
   * covers it in turn. Stage screens ignore it.
   */
  logo: PropItem | null;
  /** What Clear all took down can be put back: nothing else has gone up since. */
  canPutBack: boolean;
  /** What Next will show, or null when nothing follows. */
  next: UpNext | null;
  /** Put first in line for Next (the arti at its time), or null. */
  cue: CuedNext | null;
  /** Today's entry in the loaded calendars (Samvat date, tithi, festivals), or null when none gives today. */
  calendar: CalendarDay | null;
  /** The idle rotation: what it shows, and whether the operator started it (shared/idle.ts). */
  idle: IdleState;
  /** The quote of the day (one per date), or null when there are no quotes. */
  quote: Quote | null;
  /** The playlist's next items after the one playing (headers too), up to UPCOMING_ITEMS. */
  upcoming: UpcomingItem[];
  /** A message for the performers on stage screens; the audience never sees it. */
  stageMessage: string | null;
  /** Every timer, with when it was started: windows work out the time themselves. */
  timers: TimerState[];
  /**
   * The slide on the screens moves on by itself: counting from startedAt
   * (main-process clock) for durationMs. Windows show the time left.
   */
  autoAdvance: { startedAt: number; durationMs: number } | null;
  /**
   * The live Look (shared/looks.ts): each screen group's layers, languages
   * and slide style. Switching it changes every group at once.
   */
  look: LiveLook;
}

export function emptyLayers(): Layers {
  return { audio: null, background: null, slide: null, props: [], messages: [], ticker: null, masks: null };
}

export function initialEngineState(): EngineState {
  return {
    version: ENGINE_STATE_VERSION,
    live: { presentationId: null, slideIndex: null, slideCount: 0, arrangementId: null, playlist: null },
    layers: emptyLayers(),
    blackout: false,
    logo: null,
    canPutBack: false,
    next: null,
    cue: null,
    calendar: null,
    idle: NO_IDLE,
    quote: null,
    upcoming: [],
    stageMessage: null,
    timers: [],
    autoAdvance: null,
    look: NO_LOOK,
  };
}

/** True when the layer shows nothing. */
export function isLayerEmpty(layers: Layers, layer: LayerName): boolean {
  const value = layers[layer];
  return Array.isArray(value) ? value.length === 0 : value === null;
}
