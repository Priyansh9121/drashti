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

/** One step of a slide: what moves at its click, as a clip, and the still it ends on. */
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
  /** It plays on across this many slides (PowerPoint's numSld); left out, its own slide only. */
  acrossSlides?: number;
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
  /** Step 0 (coming in), then one per click; at least one. */
  steps: DeckStep[];
  media: DeckMedia[];
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
  return deck ? Math.max(1, deck.steps.length) : 1;
}
