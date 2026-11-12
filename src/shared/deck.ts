import type { DeckNativeTransition } from './deck-transition';
import type { PlaybackClip } from './media';
import type { Transition } from './model';

/*
 * A PowerPoint or Keynote deck shown as it was (Session 54, C2, from C1's trial: assister/session-54-deck-trial.md).
 * At import, where this computer has PowerPoint or Keynote, the deck's own app makes a movie of it, which Drashti
 * cuts into one clip per click and keeps each clip's last frame; the deck's videos and sounds come out of the file
 * as real media. A slide made so carries a `DeckSlide` beside its picture (the picture is its last frame, so every
 * place that draws a slide's picture today still draws it whole). Step 0 is the slide coming in (its transition and
 * whatever runs by itself), then one step per click. Every screen plays a step's clip from the engine's time and
 * then holds its last frame (or loops its hold), so a node, the stream, key and fill, the stage and the phones show
 * the same step at the same moment (docs/design.md §40). Without PowerPoint or Keynote, a deck comes in as pictures,
 * as before, with its videos and sounds still real media.
 */

/** Which app made the deck's movie, or none (pictures, as before Session 54). */
export type DeckBaker = 'powerpoint' | 'keynote' | 'pictures';

export type DeckEffectDirection = 'left' | 'right' | 'up' | 'down';

export type DeckEffectKind =
  | 'appear'
  | 'fade'
  | 'fly'
  | 'wipe'
  | 'zoom'
  | 'spin'
  | 'pulse'
  | 'float'
  | 'split'
  | 'grow-shrink'
  | 'shape'
  | 'wheel'
  | 'bars'
  | 'bounce';

/** An effect from the deck's own click sequence, targeted at its slide-local shape or group id. */
export interface DeckEffect {
  shapeId: string;
  /** Zero runs with the slide; the following steps are one per click. */
  step: number;
  phase: 'in' | 'out' | 'emphasis';
  kind: DeckEffectKind;
  delayMs: number;
  durationMs: number;
  /** PowerPoint's smooth start and smooth end, as shares of the duration (SMIL's accelerate and decelerate). */
  accel?: number;
  decel?: number;
  /** The direction of travel. */
  direction?: DeckEffectDirection;
  /** The second axis of a diagonal Fly. */
  verticalDirection?: 'up' | 'down';
  degrees?: number;
  /** Gallery Zoom fades during its scale. */
  fade?: true;
  /** Float's travel as a fraction of the slide along its direction. */
  distance?: number;
  /** Split expands or contracts around the center along this axis. */
  splitAxis?: 'x' | 'y';
  /** Gallery Zoom's outer scale or Grow/Shrink's final scale. */
  scale?: number;
  /** Shape's outline, opening from the centre (or closing towards it when inward). */
  shape?: 'circle' | 'box' | 'diamond' | 'plus';
  /** Shape or Split reveals from the edges towards the centre (PowerPoint's "In"). */
  inward?: true;
  /** Wheel's spokes. */
  spokes?: number;
  /** Random Bars' bars: horizontal strips or vertical ones. */
  bars?: 'horizontal' | 'vertical';
  /**
   * The paragraphs of a text box (the first and the last, from 0) that this entrance or exit shows or hides, when the
   * deck builds the box paragraph by paragraph. The box itself stays.
   */
  paragraphs?: [number, number];
}

export interface DeckMotion {
  effects: DeckEffect[];
  /** How long each step runs, from the automatic step (0) through the last click. */
  stepsMs: number[];
  /** One or more source effects were replaced by the closest playable effect. */
  approximate: boolean;
}

/** One baked step: what moves at its click, as a clip, and the still it ends on. */
export interface DeckStep {
  /** The step's motion: a video in Media (no sound), hidden from the Media list as a deck's pages are. */
  clipId: string;
  /** How long the clip is, in ms. */
  clipMs: number;
  /** Step 0 only: how much of its clip is the deck's own transition, in ms (0 for none). */
  transitionMs?: number;
  /** The still the step ends on: a picture in Media, hidden from the Media list. */
  lastId: string;
  /**
   * A one-turn loop played while the step waits for the next click (a spin or a pulse that repeats "until the end
   * of the slide"): a video in Media and its length. Left out, the step holds its last frame.
   */
  holdId?: string;
  holdMs?: number;
}

/** When one of the deck's videos or sounds starts. */
export type DeckMediaStart =
  /** With a step: at its `shownAt` plus `offsetMs` (step 0 is "with the slide"). */
  | { step: number; offsetMs: number }
  /** Only when clicked on (a shape trigger in PowerPoint): never by Next, but from the time bar's Play. */
  | { clicked: true };

/** One of the deck's own videos or sounds, as a real media file in Drashti. */
export interface DeckMedia {
  kind: 'video' | 'audio';
  mediaId: string;
  /** Where it sits on the slide, as fractions of the slide's width and height (a sound's is its icon's). */
  box: { x: number; y: number; w: number; h: number };
  /** The picture shown before it plays (a video's poster), a picture in Media. */
  posterId?: string;
  /** The deck's trims, as start and end points (ms into the file). */
  clip?: PlaybackClip;
  loop: boolean;
  /** 0 to 1. */
  volume: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  start: DeckMediaStart;
  /**
   * It plays on across this many slides (PowerPoint's numSld; 999 for Play Across Slides), its own the first; left
   * out, its own slide only. A sound that starts with its slide or at a click so plays on the audio layer (Session
   * 54, main/engine/across-slides.ts); one only a click on it starts stays on its slide.
   */
  acrossSlides?: number;
  /** Its shape's name in the deck (Session 54): a sound set to play across slides goes by it on LIVE's line. */
  name?: string;
  /** Hidden while it is not playing (a sound's icon, PowerPoint's showWhenStopped="0"). */
  hideWhenStopped?: boolean;
  /** The step it appears at, by its entrance animation (Session 54, C review); left out, from step 0. */
  enterStep?: number;
  /** The step it leaves at, by its exit animation; left out, it never leaves. */
  exitStep?: number;
}

/** The deck's own transition into a slide. */
export interface DeckTransition {
  /** Its name in the deck (`push`, `p14:vortex`, `p159:morph`, Keynote's `cube`…), for the report and the editor. */
  name: string;
  durationMs: number;
  /** The closest transition Drashti can draw from editable shapes, when playing without a baked clip. */
  nativeTransition?: DeckNativeTransition;
  /** Its sound, an audio file in Media, played as the slide comes in. */
  soundId?: string;
}

/** Drashti's own transition on a deck's slide (more than PowerPoint): over the deck's own, or instead of it. */
export interface DeckDrashtiTransition {
  transition: Transition;
  /** 'over': Drashti's transition, with the deck's own playing inside it; 'instead': the deck's own is skipped. */
  mode: 'over' | 'instead';
}

/** What a slide made from a deck carries beside its picture. */
export interface DeckSlide {
  transition?: DeckTransition;
  /** The deck's own "after N s", kept for the report only: Drashti moves on by itself only when told to. */
  deckAdvanceMs?: number;
  /**
   * The last still of the slide this one's step-0 clip was made after (the lastId of the deck's previous shown
   * slide's last step; Session 54, C review); left out for the first slide and a deck made before.
   */
  after?: string;
  /** The baked last frame kept as the starting picture of a later slide's fallback transition. */
  sourceStillId?: string;
  /** Baked step 0 (coming in), then one per click. Empty for a deck played from its editable shapes. */
  steps: DeckStep[];
  /** PowerPoint's effects, kept alongside baked clips for the editor when a slide needs a video fallback. */
  motion?: DeckMotion;
  media: DeckMedia[];
  /**
   * Its animations are still being made (Session 56): it shows its picture, a still step, while the import makes its
   * clips; Next waits for it, saying so, and the mark goes once its clips are in. Left out: ready.
   */
  preparing?: true;
  /** Set in Drashti's editor: its own transition into this slide; left out, the deck's own. */
  drashti?: DeckDrashtiTransition;
  /**
   * Set in Drashti's editor: its own transition for a step (by index, from 1), over the step's own motion or instead
   * of it (C2's show: 'instead' goes from the step before's last frame to the step's own, its clip not played).
   */
  stepTransitions?: Record<number, DeckDrashtiTransition>;
}

/** How the deck came in, for the import report and the library. */
export interface DeckImport {
  baker: DeckBaker;
  /** How long the bake took, in ms (0 for pictures). */
  bakeMs: number;
  /** The movie's size and rate (a baked deck's). */
  width?: number;
  height?: number;
  fps?: number;
}

/** How many steps a slide has: its deck's, or one for any other slide. */
export function stepCount(deck: DeckSlide | undefined): number {
  return Math.max(1, nativeDeckMotion(deck)?.stepsMs.length ?? deck?.steps.length ?? 0);
}

/** Baked clips win until the slide is edited and the clips are removed. */
export function nativeDeckMotion(deck: DeckSlide | undefined): DeckMotion | undefined {
  return deck?.steps.length === 0 ? deck.motion : undefined;
}
