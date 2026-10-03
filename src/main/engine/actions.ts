import type { LiveLook } from '../../shared/looks';
import type { RenderSlide, Transition } from '../../shared/model';
import type { TimerDefinition, TimerRun } from '../../shared/timers';
import type {
  AudioLayer,
  BackgroundLayer,
  LayerName,
  Layers,
  LiveCursor,
  MaskLayer,
  MessageItem,
  PlaylistCursor,
  PropItem,
  TickerItem,
  TickerLayer,
  UpcomingItem,
  UpNext,
} from '../../shared/engine/state';

/**
 * Resolved, internal actions. Commands from the UI are turned into these
 * after the engine has looked up whatever they refer to, so the reducer can
 * stay a pure function.
 */
export type EngineAction =
  | {
      type: 'slide/show';
      presentationId: string;
      slideIndex: number;
      slideCount: number;
      arrangementId: string | null;
      /** The playlist item it is played from, if any. */
      playlist: PlaylistCursor | null;
      slide: RenderSlide;
      notes: string;
      /** The time, for the slide layer's shownAt. */
      at: number;
      /** How it comes on (a dissolve); left out for a cut. Kept when the same slide is shown again. */
      transition?: Transition;
    }
  /** The live position moves (the order changed) while the same slide stays on screen. */
  | { type: 'live/move'; slideIndex: number; slideCount: number; arrangementId: string | null }
  /** The cursor moves to a playlist item that is not a presentation (a picture, video or sound). */
  | { type: 'live/item'; playlist: PlaylistCursor }
  | { type: 'next/set'; next: UpNext | null }
  | { type: 'upcoming/set'; upcoming: UpcomingItem[] }
  | { type: 'stage/message'; text: string | null }
  /** The timers as defined in the library; each keeps its run (start time, counted time). */
  | { type: 'timers/define'; timers: readonly TimerDefinition[] }
  | { type: 'timer/run'; timerId: string; run: TimerRun }
  | { type: 'layer/clear'; layer: LayerName }
  | { type: 'layers/clearAll' }
  | { type: 'blackout/set'; on: boolean }
  | { type: 'logo/set'; prop: PropItem | null }
  /** Put the layers (and the live position) back exactly as they were: Put it back, and Back. */
  | { type: 'show/put'; live: LiveCursor; layers: Layers }
  | { type: 'background/set'; background: BackgroundLayer }
  | { type: 'audio/set'; audio: AudioLayer }
  | { type: 'prop/show'; prop: PropItem }
  | { type: 'prop/hide'; propId: string }
  | { type: 'message/show'; message: MessageItem }
  | { type: 'message/hide'; messageId: string }
  /** An announcement joins the ticker (or its words change): it starts again from the right at `at`. */
  | { type: 'ticker/show'; item: TickerItem; at: number }
  /** An announcement leaves the ticker: the rest start again from the right at `at`. */
  | { type: 'ticker/hide'; itemId: string; at: number }
  /** Restart recovery: the ticker as it was, carrying on in step. */
  | { type: 'ticker/set'; ticker: TickerLayer }
  | { type: 'mask/set'; mask: MaskLayer }
  /** Restart recovery: the count as it was, with the time it had left. */
  | { type: 'advance/set'; autoAdvance: { startedAt: number; durationMs: number } | null }
  /** The live Look, every group's settings resolved from the library. */
  | { type: 'look/set'; look: LiveLook };
