import type { DeckMedia, DeckSlide } from '../../shared/deck';
import { deckStep, lastStep, stepOf, stepTiming, takingTime } from '../../shared/deck-show';
import type { SlideLayer, VideoSeeks } from '../../shared/engine/state';
import type { PlaybackSeek } from '../../shared/media';
import type { Transition } from '../../shared/model';

/*
 * A deck's slide stepped through its clicks in the engine (Session 54, C2; shared/deck.ts, shared/deck-show.ts). A
 * slide made from a PowerPoint or Keynote deck has a step for its coming in, then one per click. Next shows its next
 * step, and from its last the next slide's coming in; Back and Previous show the step before at its last frame at
 * once, with no motion, and from its first the slide before at its last step. Each is a new slide layer with the
 * step and when it was shown, from which every screen plays the step's clip (show-engine.ts sends it). Coming in
 * order, by Next from the deck's slide before, the deck's own transition plays inside the coming-in clip; come to by
 * a jump, or with Drashti's own transition set instead of it, the clip starts past it, under Drashti's transition;
 * set over it, Drashti's plays around the deck's.
 *
 * The deck's videos and sounds play as real media, stamped here in the slide layer's `seeks` (the time bar's, Session
 * 54), so every screen, node, the stream and the audio player play them alike and the time bar moves them: each
 * waits at its start point, its poster shown (`waiting`), until its step comes, then plays from that step's moment
 * plus its offset; one started only by a click on it waits for the time bar's Play. Back undoes its click: what it
 * started waits again.
 */

/** How a deck's slide is come to: by Next from the slide before it, by a jump, or back from the slide after it. */
export type DeckEntry = 'order' | 'jump' | 'back';

/** A deck's video or sound waiting at its start point (its trim), its poster shown, from `at`. */
export function waitingSeek(m: DeckMedia, at: number): PlaybackSeek {
  return { at, toMs: m.clip?.startMs ?? 0, paused: true, waiting: true };
}

/** Its step's number: a click's, 0 with the slide; null when only a click on it starts it. */
const stepOfMedia = (m: DeckMedia): number | null => ('step' in m.start ? m.start.step : null);

/** Plays from `at`, from where it waits (its start point, or where the time bar left it paused). */
function playing(m: DeckMedia, at: number, was: PlaybackSeek | undefined): PlaybackSeek {
  return { at, toMs: was?.paused ? was.toMs : (m.clip?.startMs ?? 0) };
}

/** The deck's media moves of a slide come to at step `index` at `at` (its clip from `fromMs`). */
function entrySeeks(deck: DeckSlide, index: number, at: number, fromMs: number): VideoSeeks | undefined {
  const seeks: VideoSeeks = {};
  for (const m of deck.media) {
    const step = stepOfMedia(m);
    // With the slide: from its moment in the coming-in clip (its offset counts from the clip's start, so a clip
    // started past the deck's own transition starts them that much sooner); every other waits.
    if (step === 0 && 'offsetMs' in m.start) {
      const offset = Math.max(0, m.start.offsetMs - (index === 0 ? fromMs : 0));
      seeks[m.mediaId] = playing(m, at + offset, undefined);
    } else seeks[m.mediaId] = waitingSeek(m, at);
  }
  return Object.keys(seeks).length > 0 ? seeks : undefined;
}

/** The deck's media moves as step `index` comes by Next at `at`: what starts at that step plays from its offset. */
function forwardSeeks(
  deck: DeckSlide,
  index: number,
  at: number,
  seeks: VideoSeeks | undefined,
): VideoSeeks | undefined {
  let out = seeks;
  for (const m of deck.media) {
    if (stepOfMedia(m) !== index || !('offsetMs' in m.start)) continue;
    const was = seeks?.[m.mediaId];
    // Already played on from the time bar before its click: it goes on as it is.
    if (was && !was.paused) continue;
    out = { ...out, [m.mediaId]: playing(m, at + Math.max(0, m.start.offsetMs), was) };
  }
  return out;
}

/** Back to step `index` at `at`: what a later click started waits again; the rest goes on as it is. */
function backSeeks(
  deck: DeckSlide,
  index: number,
  at: number,
  seeks: VideoSeeks | undefined,
): VideoSeeks | undefined {
  let out = seeks;
  for (const m of deck.media) {
    const step = stepOfMedia(m);
    if (step === null || step <= index || out?.[m.mediaId]?.waiting) continue;
    out = { ...out, [m.mediaId]: waitingSeek(m, at) };
  }
  return out;
}

/** A layer with these moves (none: left out). */
function withSeeks(layer: SlideLayer, seeks: VideoSeeks | undefined): SlideLayer {
  const { seeks: _was, ...rest } = layer;
  return seeks && Object.keys(seeks).length > 0 ? { ...rest, seeks } : rest;
}

/** A layer showing `index` from `at`, from `fromMs` into its clip (0: left out). */
function atStep(layer: SlideLayer, index: number, at: number, fromMs: number): SlideLayer {
  const { stepFromMs: _was, ...rest } = layer;
  return { ...rest, step: index, stepAt: at, ...(fromMs > 0 ? { stepFromMs: fromMs } : {}) };
}

/** Next on a deck's slide: its next step, from `at`; null at its last step (Next goes on to the next slide). */
export function stepForward(layer: SlideLayer, at: number): SlideLayer | null {
  const deck = layer.slide.deck;
  const index = stepOf(layer);
  if (!deck || index >= lastStep(deck)) return null;
  return withSeeks(atStep(layer, index + 1, at, 0), forwardSeeks(deck, index + 1, at, layer.seeks));
}

/**
 * Back on a deck's slide: the step before, at its last frame at once, with no motion (as PowerPoint's own Back), what
 * the click undone started waiting again; null at its first step (Back goes on to the slide before).
 */
export function stepBack(layer: SlideLayer, at: number): SlideLayer | null {
  const deck = layer.slide.deck;
  const index = stepOf(layer);
  if (!deck || index <= 0) return null;
  const to = index - 1;
  return withSeeks(
    atStep(layer, to, at, deckStep(deck, to)?.clipMs ?? 0),
    backSeeks(deck, to, at, layer.seeks),
  );
}

/**
 * A deck's slide put back (Back undoing a Next) whose step was still moving: shown at its last frame from `at`, with
 * no motion. The same layer when it is no deck's, or its step's motion is over.
 */
export function settledStep(layer: SlideLayer, at: number): SlideLayer {
  const timing = stepTiming(layer);
  if (!timing || timing.still || at >= timing.endsAt) return layer;
  return atStep(layer, timing.index, at, timing.step.clipMs);
}

/**
 * The deck's own transition's sound from `at`, as its slide comes in with that transition (C review): stamped with the
 * slide's media, so it plays on to its end whatever clicks come meanwhile (it was cut off by the first).
 */
function withChime(deck: DeckSlide, seeks: VideoSeeks | undefined, at: number): VideoSeeks | undefined {
  const chime = deck.transition?.soundId;
  return chime ? { ...seeks, [chime]: { at, toMs: 0 } } : seeks;
}

/** How a deck's slide comes on: its step, how far into the step's clip, its transition and its media's moves. */
export interface DeckShow {
  step: number;
  /** How far into the step's clip it is shown from (ms); 0 from its start. */
  fromMs: number;
  /** Drashti's transition into it; undefined for a cut (the deck's own plays inside its clip, or none). */
  transition: Transition | undefined;
  seeks: VideoSeeks | undefined;
}

/**
 * How a deck's slide comes on at `at` (show-engine.ts showSlide). Back into it (from the slide after): at its last step,
 * still, as a cut. By Next from the deck's slide before it (`inOrder`): its coming-in clip from its start, the deck's
 * own transition in it, alone or with Drashti's set over it. Otherwise (a jump; Drashti's set instead): past the deck's
 * own transition, under Drashti's (the slide's own, else `jumpWith`: the presentation's or Drashti's default).
 */
export function deckShow(
  deck: DeckSlide,
  entry: DeckEntry,
  inOrder: boolean,
  jumpWith: Transition | undefined,
  at: number,
): DeckShow {
  if (entry === 'back') {
    const last = lastStep(deck);
    const fromMs = deckStep(deck, last)?.clipMs ?? 0;
    return { step: last, fromMs, transition: undefined, seeks: entrySeeks(deck, last, at, fromMs) };
  }
  const own = deck.drashti;
  if (entry === 'order' && inOrder && own?.mode !== 'instead') {
    const transition = own?.mode === 'over' ? takingTime(own.transition) : undefined;
    return { step: 0, fromMs: 0, transition, seeks: withChime(deck, entrySeeks(deck, 0, at, 0), at) };
  }
  const fromMs = Math.max(0, deckStep(deck, 0)?.transitionMs ?? 0);
  const transition = own ? takingTime(own.transition) : jumpWith;
  return { step: 0, fromMs, transition, seeks: entrySeeks(deck, 0, at, fromMs) };
}

/** A deck's slide's step is past its last: more of its clicks to come (an auto-advance steps through them first). */
export const stepsLeft = (layer: SlideLayer): boolean =>
  layer.slide.deck !== undefined && stepOf(layer) < lastStep(layer.slide.deck);

/** How long a step's clip has left to play from `at` (ms), so a slide moving on by itself never cuts it short. */
export function clipLeftMs(layer: SlideLayer, at: number): number {
  const timing = stepTiming(layer);
  return timing && !timing.still ? Math.max(0, timing.endsAt - at) : 0;
}
