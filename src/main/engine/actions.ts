import type { CalendarDay } from '../../shared/calendar';
import type { IdleState, Quote } from '../../shared/idle';
import type { LiveLook } from '../../shared/looks';
import type { LiveZoom, PictureLook } from '../../shared/picture-look';
import type { RenderSlide, Transition } from '../../shared/model';
import type { TimerDefinition, TimerRun } from '../../shared/timers';
import type {
  AudioLayer,
  BackgroundLayer,
  CuedNext,
  LayerName,
  Layers,
  LiveCursor,
  LowerThirdLayer,
  MaskLayer,
  MessageItem,
  PipLayer,
  PlaylistCursor,
  PropItem,
  RepeatRun,
  SlideLayer,
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
  /**
   * A slide up in the slide's place that is no presentation's (Session 50: a timer shown alone); the live
   * position stays where it was, so Next goes on from there.
   */
  | { type: 'slide/put'; layer: SlideLayer }
  /** The live position moves (the order changed) while the same slide stays on screen. */
  | { type: 'live/move'; slideIndex: number; slideCount: number; arrangementId: string | null }
  /** The cursor moves to a playlist item that is not a presentation (a picture, video or sound). */
  | { type: 'live/item'; playlist: PlaylistCursor }
  | { type: 'next/set'; next: UpNext | null }
  | { type: 'cue/set'; cue: CuedNext | null }
  /** Today's calendar entry (a new day, or a calendar loaded or removed). */
  | { type: 'calendar/set'; calendar: CalendarDay | null }
  /** The idle rotation starts (at a time) or stops (null). */
  | { type: 'idle/run'; startedAt: number | null }
  /** What the idle rotation shows (the admin's pictures, the quote of the day), and for how long each. */
  | { type: 'idle/set'; content: Omit<IdleState, 'startedAt'> }
  | { type: 'quote/set'; quote: Quote | null }
  | { type: 'upcoming/set'; upcoming: UpcomingItem[] }
  | { type: 'stage/message'; text: string | null }
  /** The timers as defined in the library; each keeps its run (start time, counted time). */
  | { type: 'timers/define'; timers: readonly TimerDefinition[] }
  | { type: 'timer/run'; timerId: string; run: TimerRun }
  /** `at`: when, by the engine's clock (the slide layer's: a lower third leaves from then, Session 27). */
  | { type: 'layer/clear'; layer: LayerName; at?: number }
  | { type: 'layers/clearAll' }
  | { type: 'blackout/set'; on: boolean }
  /** `at`: when, by the engine's clock (its videos play from then, Session 27); a logo already up keeps its own. */
  | { type: 'logo/set'; prop: PropItem | null; at?: number }
  /** Put the layers (and the live position) back exactly as they were: Put it back, and Back. */
  | { type: 'show/put'; live: LiveCursor; layers: Layers }
  | { type: 'background/set'; background: BackgroundLayer }
  | { type: 'audio/set'; audio: AudioLayer }
  /** `at`: when, by the engine's clock (its videos play from then, Session 27); a prop already up keeps its own. */
  | { type: 'prop/show'; prop: PropItem; at?: number }
  | { type: 'prop/hide'; propId: string }
  /** `at`: when, by the engine's clock (its entrance, Session 27); a message already up keeps its own. */
  | { type: 'message/show'; message: MessageItem; at?: number }
  | { type: 'message/hide'; messageId: string }
  /** An announcement joins the ticker (or its words change): it starts again from the right at `at`. */
  | { type: 'ticker/show'; item: TickerItem; at: number }
  /** An announcement leaves the ticker: the rest start again from the right at `at`. */
  | { type: 'ticker/hide'; itemId: string; at: number }
  /** Restart recovery: the ticker as it was, carrying on in step. */
  | { type: 'ticker/set'; ticker: TickerLayer }
  | { type: 'mask/set'; mask: MaskLayer }
  /** A lower third up (Session 44); the same one again only changes its words and look, keeping its time. */
  | { type: 'lowerThird/show'; layer: LowerThirdLayer }
  /** The lower third hidden: its out plays from `at`. */
  | { type: 'lowerThird/hide'; at: number }
  /** The picture-in-picture box up as given (Session 50): put up, its picture changed, swapped or moved. */
  | { type: 'pip/set'; layer: PipLayer }
  /** The box taken off (Take off): its out plays from `at`. */
  | { type: 'pip/hide'; at: number }
  /** Restart recovery: the count as it was, with the time it had left. */
  | { type: 'advance/set'; autoAdvance: { startedAt: number; durationMs: number } | null }
  /** Repeat Slides going round, or stopped (Session 26d). */
  | { type: 'repeat/set'; repeat: RepeatRun | null }
  /** The looks of the pictures in use, and the live zoom (Session 26e). */
  | { type: 'pictures/set'; pictures: Record<string, PictureLook> }
  | { type: 'zoom/set'; liveZoom: LiveZoom | null }
  /** The live Look, every group's settings resolved from the library. */
  | { type: 'look/set'; look: LiveLook };
