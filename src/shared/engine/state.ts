import type { CalendarDay, CalendarLang } from '../calendar';
import type { IdleState, Quote } from '../idle';
import { NO_IDLE } from '../idle';
import type { LiveLook } from '../looks';
import type { Mask } from '../masks';
import { NO_LOOK } from '../looks';
import type { RenderSlide, SlideElement, Transition } from '../model';
import type { TimerState } from '../timers';
import type { PlaybackClip, PlaybackSeek } from '../media';
import type { PlaybackMarker } from '../markers';
import type { LiveZoom, PictureLook } from '../picture-look';
import type { LowerThird } from '../lower-thirds';

/**
 * Show engine state. The main process owns it; every renderer (and, later,
 * every remote Drashti Node) holds a copy that it keeps in sync from
 * snapshots and patches. It must stay plain, JSON-serializable data.
 *
 * Bump ENGINE_STATE_VERSION whenever the shape changes incompatibly. 9 (Session 27): each Look group's
 * Movement, new transition kinds, a message's shownAt; an older phone, browser page or node says
 * 'incompatible' rather than drawing a kind it does not know. 10 (Sessions 31–36): a slide's darkening
 * behind the words, which an older one would leave out. 11 (Session 44): the lower third's layer. 12
 * (Session 48): another app's window as the background; and, before any release read 12 (Session 50), a video
 * input as the background, a timer shown alone in the slide's place, and the picture-in-picture box; and (Session
 * 51, still before any release read 12) a video input as a playlist item and a slide's background cue: Next's
 * 'input' kind, the next slide's `input`, a slide's `inputMissing` and a coming-up item's 'input' kind. 13
 * (Session 52, after alpha.11 had published 12): a slide's and a prop's videos play between their files' start and
 * end points, which only the engine's state can tell every screen and node. 13 only adds to 12, so a state saved
 * by alpha.11 (its recovery file, a node's last picture) is read as it is: `readsEngineVersion`.
 */
export const ENGINE_STATE_VERSION = 13;

/**
 * Whether a state saved by this engine version is read whole (Session 52): this version's own, and 12, alpha.11's,
 * as 13 only adds fields to it. Any other version's layers are left out, as their shapes may differ.
 */
export function readsEngineVersion(version: unknown): boolean {
  return version === ENGINE_STATE_VERSION || version === 12;
}

export type LayerName =
  'audio' | 'background' | 'slide' | 'props' | 'pip' | 'lowerThird' | 'messages' | 'ticker' | 'masks';

/** Bottom to top, the order outputs composite visible layers in. Audio has no picture. */
export const LAYER_NAMES = [
  'audio',
  'background',
  'slide',
  'props',
  'pip',
  'lowerThird',
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
   * How it came on: a fade (a dissolve), a fade through black, a slide in or
   * a slow zoom from the slide before, from shownAt for its duration (outputs
   * that join later show it finished). Left out for a cut.
   */
  transition?: Transition;
  /**
   * A timer shown alone (Session 50: the Timers panel's Show on the screens): the slide is Drashti's Timer only
   * layout, made for that timer, in the slide's place; no presentation in the library holds it (presentationId is
   * `timer:<timerId>`). A phone names it "Timer: <name>".
   */
  timer?: TimerShow;
  /**
   * Its background cue named a video input this computer has none of (Session 51), by that name: the background
   * stayed as it was (never black because of it), and LIVE says so while the slide is up. Left out otherwise.
   */
  inputMissing?: string;
}

/** The timer a slide layer shows alone (Session 50). */
export interface TimerShow {
  timerId: string;
  /** The timer's name, for LIVE, a stage screen and a phone. */
  name: string;
}

/**
 * A Repeat Slides playlist going round by itself (Session 26d, shared/repeat.ts): its slides are those of
 * `repeat:<playlistId>`, each up for its seconds (autoAdvance counts them), the last back to the first.
 * Anything else going up, Clear all, the slide cleared, Stop or Esc ends it, and the slide stays up;
 * black-out and the logo cover it while it carries on underneath.
 */
export interface RepeatRun {
  playlistId: string;
  /** Its name, for LIVE, a stage screen and a phone ("Repeating · Lobby pictures"). */
  name: string;
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
  /** Paused this far into the track (ms played since its start point); left out while it plays. Nothing sounds while paused. */
  pausedAtMs?: number;
  /** The file's start and end points (Session 14), from the media library, when it has them. */
  clip?: PlaybackClip;
  /** Jumped to a marker (Session 14): from then it plays on from there. */
  seek?: PlaybackSeek;
  /** The file's named markers to jump to (Session 14), when it has any. */
  marks?: PlaybackMarker[];
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
 * Another app's window, live (Session 48: a Zoom meeting's window, say), fitted inside with black around it.
 * Only the main process puts one up, from the windows it offered (src/main/live-window/): never a command
 * from a window, a phone or the API. Each screen on this computer captures it; output nodes, phones and
 * stage screens cannot show it, and restart recovery never puts it back (the window may be gone).
 */
export interface WindowBackground {
  kind: 'window';
  /** The window's capture id on this computer ("window:<number>:<n>"), never a display's. */
  sourceId: string;
  /** Its name as the computer gives it ("Zoom Meeting"), for the operator, a stage screen and a phone. */
  name: string;
  /** When it went up (ms since the epoch, main-process clock): each screen captures it afresh from then. */
  startedAt: number;
}

/** How a live picture sits on the screen: inside it with black around (fit), or filling it (fill). */
export type LiveFit = 'fit' | 'fill';

/**
 * A video input, live (Session 50): a camera or capture input on this computer (a capture card, a video mixer's
 * program out through its USB output), named by the operator in Media's Video inputs ("Input 1"). It is a live
 * background: it comes on with the same fade a video does, and the slide stays over it. Each screen on this
 * computer, its LIVE picture and the stream's page open it (video only, never sound); output nodes and phones
 * cannot show it. Restart recovery puts it back when that input is there.
 */
export interface InputBackground {
  kind: 'input';
  /** The video input's id in this computer's list (shared/video-inputs.ts). */
  inputId: string;
  /** Its name as the operator gave it ("Input 1"), for LIVE, a stage screen, a phone and the notices. */
  name: string;
  /** The device's name as this computer gives it (its label), by which each screen finds it. */
  device: string;
  fit: LiveFit;
  /** When it went up (ms since the epoch, main-process clock). */
  startedAt: number;
  /** It came on dissolving from the background before, with its slide: from `at` for `durationMs`. */
  fade?: { at: number; durationMs: number };
}

/**
 * What the background layer shows: a colour, an image or video from the
 * media library, another app's window (Session 48) or a video input (Session 50). A slide's background cue sets
 * it (PLAN.md 4.3); it stays up on later slides until something replaces or clears it.
 */
export type BackgroundLayer =
  | { kind: 'color'; color: string }
  | WindowBackground
  | InputBackground
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
      /** The file's start and end points (Session 14): a looping video loops between them. */
      clip?: PlaybackClip;
      /** Jumped to a marker (Session 14): from then it plays on from there. */
      seek?: PlaybackSeek;
      /** The file's named markers to jump to (Session 14), when it has any. */
      marks?: PlaybackMarker[];
    });

export interface PropItem {
  id: string;
  name: string;
  elements: SlideElement[];
  /** The canvas its elements are placed on (1920 x 1080 when left out); screens scale it as they do slides. */
  width?: number;
  height?: number;
  /**
   * When it went up, by the engine's clock (Session 27): its videos play from then on every screen, in step
   * (before, each window played them from when it drew them). Kept while it stays up.
   */
  shownAt?: number;
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
  /**
   * When it went up, by the engine's clock (Session 27): the banner's entrance is timed from it, and an
   * update keeps it, so changing the words never plays the entrance again. Left out where nothing came in
   * (a window's request carries none; a restored message comes back still).
   */
  shownAt?: number;
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
  /** When the words began their current run (again each time an announcement joins or leaves). */
  startedAt: number;
  /**
   * When the band came up, by the engine's clock (Session 27): its own entrance, kept while the words
   * change. Left out for a band that comes back still (recovery).
   */
  shownAt?: number;
}

/**
 * The Masks layer: a mask from the library (shared/masks.ts) the operator
 * put up on the audience screens, until it is cleared (F8, Clear all).
 */
export type MaskLayer = Mask;

/**
 * A lower third on the screens (Session 44, shared/lower-thirds.ts): the library's, as it was when shown, so
 * every screen, node and phone draws it without the library; and when it went up, by the engine's clock, so
 * its in plays from then, the same frame everywhere. One at a time: another shown takes its place.
 */
export interface LowerThirdLayer extends LowerThird {
  shownAt: number;
}

/**
 * What the picture-in-picture box holds (Session 50): a video input, a video or picture from Media, another app's
 * window, or the slides (the slide as designed, made small, while the main picture shows the background).
 */
export type PipSource =
  | { kind: 'slides' }
  | { kind: 'media'; mediaId: string; media: 'image' | 'video' }
  | { kind: 'input'; inputId: string; name: string; device: string }
  | { kind: 'window'; sourceId: string; name: string };

export type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const PIP_CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const satisfies readonly PipCorner[];

/** Small, Medium or Large: a quarter, a third or two fifths of the screen's width, always 16:9. */
export type PipSize = 'small' | 'medium' | 'large';
export const PIP_SIZES = ['small', 'medium', 'large'] as const satisfies readonly PipSize[];

/** How the box comes on and goes off: a fade, a scale, or a slide in from its corner. */
export type PipMotion = 'fade' | 'scale' | 'slide';
export const PIP_MOTIONS = ['fade', 'scale', 'slide'] as const satisfies readonly PipMotion[];

/** Where the box sits and how it looks, as the library remembers it for next time. */
export interface PipPlace {
  /** The corner it sits in, or null once dragged elsewhere (then x and y say where). */
  corner: PipCorner | null;
  /** Its top-left corner, as fractions of the screen's width and height (0 to 1). */
  x: number;
  y: number;
  size: PipSize;
  border: boolean;
  rounded: boolean;
  motion: PipMotion;
}

/**
 * The picture-in-picture box on the audience screens (Session 50). Black-out and the logo cover it, Clear all
 * takes it off, a Look can leave it out of a group, and a phone names it. No sound comes from it.
 */
export interface PipLayer {
  source: PipSource;
  place: PipPlace;
  /** The box's picture and the main picture changed places (Swap). */
  swapped: boolean;
  /** When it came on, by the engine's clock: its in plays from then, and a video in it plays from then. */
  shownAt: number;
  /** The last Swap or move, by the engine's clock, and how it was before: it animates from there. */
  changed?: { at: number; place: PipPlace; swapped: boolean };
}

export interface Layers {
  audio: AudioLayer | null;
  background: BackgroundLayer | null;
  slide: SlideLayer | null;
  props: PropItem[];
  /** The picture-in-picture box (Session 50), or null. */
  pip: PipLayer | null;
  lowerThird: LowerThirdLayer | null;
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
      /**
       * The video input its background cue names (Session 51), by its name: this computer's input of that name
       * goes up behind it (or, with none, the background stays as it was). Left out when it names none.
       */
      input?: string;
      /** The playlist item it starts, when it is in the next item. */
      itemId: string | null;
      /** Its notes, for a presenter's remote (Session 18). */
      notes: string;
    }
  | { kind: 'media'; itemId: string; mediaId: string; media: 'image' | 'video' | 'audio'; label: string }
  /** The next playlist item is one of this computer's video inputs (Session 51), named as Media has it now. */
  | { kind: 'input'; itemId: string; inputId: string; name: string; label: string };

/** One of the playlist's next items, for a stage screen ("coming up"); a video input since Session 51. */
export interface UpcomingItem {
  id: string;
  label: string;
  kind: 'presentation' | 'media' | 'header' | 'input';
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
  /** A Repeat Slides playlist going round (Session 26d), or null. */
  repeat: RepeatRun | null;
  /**
   * The looks of the pictures on the screens and coming next (Session 26e, shared/picture-look.ts), by media
   * id: every screen, node, phone and the stream draw them alike. A picture without one is left out.
   */
  pictures: Record<string, PictureLook>;
  /** The picture on the screens zoomed and moved from LIVE, for this showing only (Session 26e), or null. */
  liveZoom: LiveZoom | null;
  /**
   * The live Look (shared/looks.ts): each screen group's layers, languages
   * and slide style. Switching it changes every group at once.
   */
  look: LiveLook;
  /**
   * The slide just taken off the screens on its own (the slide layer cleared, never Clear all), and when by
   * the engine's clock (Session 27): a lower third leaves with a short fade from then, the same on every
   * screen. Null once another slide goes up, after Clear all, and when nothing was taken off.
   */
  slideOff: { layer: SlideLayer; at: number } | null;
  /**
   * The lower third just hidden (Session 44), and when by the engine's clock: its out plays from then, the same on
   * every screen. Null once one is shown again, after Clear all (which takes it off at once) and Put it back.
   */
  lowerThirdOff: { layer: LowerThirdLayer; at: number } | null;
  /**
   * The picture-in-picture box just taken off (Session 50), and when by the engine's clock: its out plays from then,
   * the same on every screen. Null once a box is up again, after Clear all (which takes it off at once) and Put it
   * back.
   */
  pipOff: { layer: PipLayer; at: number } | null;
}

export function emptyLayers(): Layers {
  return {
    audio: null,
    background: null,
    slide: null,
    props: [],
    pip: null,
    lowerThird: null,
    messages: [],
    ticker: null,
    masks: null,
  };
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
    repeat: null,
    pictures: {},
    liveZoom: null,
    look: NO_LOOK,
    slideOff: null,
    lowerThirdOff: null,
    pipOff: null,
  };
}

/** True when the layer shows nothing. */
export function isLayerEmpty(layers: Layers, layer: LayerName): boolean {
  const value = layers[layer];
  return Array.isArray(value) ? value.length === 0 : value === null;
}
