import type { Rect, RenderSlide, SlideElement } from '../model';
import type { TimerState } from '../timers';

/**
 * Show engine state. The main process owns it; every renderer (and, later,
 * every remote Drashti Node) holds a copy that it keeps in sync from
 * snapshots and patches. It must stay plain, JSON-serializable data.
 *
 * Bump ENGINE_STATE_VERSION whenever the shape changes incompatibly.
 */
export const ENGINE_STATE_VERSION = 4;

export type LayerName = 'audio' | 'background' | 'slide' | 'props' | 'messages' | 'masks';

/** Bottom to top, the order outputs composite visible layers in. Audio has no picture. */
export const LAYER_NAMES = [
  'audio',
  'background',
  'slide',
  'props',
  'messages',
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

/**
 * What the audio layer plays. It stays on later slides until something
 * replaces or clears it; the same file on a later slide carries on.
 */
export interface AudioLayer extends AudioChoice {
  /** When it started (ms since the epoch, main-process clock), so the sound stays where it is. */
  startedAt: number;
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
    });

export interface PropItem {
  id: string;
  name: string;
  elements: SlideElement[];
  /** The canvas its elements are placed on (1920 x 1080 when left out); screens scale it as they do slides. */
  width?: number;
  height?: number;
}

/** Part of a message: words, or a timer shown live (each window works out its time). */
export type MessagePart = { kind: 'text'; text: string } | { kind: 'timer'; timerId: string };

export interface MessageItem {
  id: string;
  /** The message as plain text (a timer as its name in brackets). */
  text: string;
  /** When given, what is drawn: its words and live timers. */
  parts?: MessagePart[];
}

/** A mask leaves `visible` showing and blacks out the rest of the canvas. Units: canvas pixels. */
export interface MaskLayer {
  id: string;
  name: string;
  visible: Rect;
}

export interface Layers {
  audio: AudioLayer | null;
  background: BackgroundLayer | null;
  slide: SlideLayer | null;
  props: PropItem[];
  messages: MessageItem[];
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

export interface EngineState {
  version: typeof ENGINE_STATE_VERSION;
  live: LiveCursor;
  layers: Layers;
  /** Output-wide black-out. Independent of the layers, so turning it off restores the picture. */
  blackout: boolean;
  /** What Next will show, or null when nothing follows. */
  next: UpNext | null;
  /** A message for the performers on stage screens; the audience never sees it. */
  stageMessage: string | null;
  /** Every timer, with when it was started: windows work out the time themselves. */
  timers: TimerState[];
}

export function emptyLayers(): Layers {
  return { audio: null, background: null, slide: null, props: [], messages: [], masks: null };
}

export function initialEngineState(): EngineState {
  return {
    version: ENGINE_STATE_VERSION,
    live: { presentationId: null, slideIndex: null, slideCount: 0, arrangementId: null, playlist: null },
    layers: emptyLayers(),
    blackout: false,
    next: null,
    stageMessage: null,
    timers: [],
  };
}

/** True when the layer shows nothing. */
export function isLayerEmpty(layers: Layers, layer: LayerName): boolean {
  const value = layers[layer];
  return Array.isArray(value) ? value.length === 0 : value === null;
}
