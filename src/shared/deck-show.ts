import { type DeckDrashtiTransition, type DeckMedia, type DeckSlide, type DeckStep, stepCount } from './deck';
import type { SlideLayer, VideoClips } from './engine/state';
import type { RenderSlide, Transition } from './model';

/*
 * A deck's slide shown as it was (Session 54, C2; shared/deck.ts), as the engine and every screen read it: the step a
 * slide layer shows, when its clip plays by the engine's clock (from the step's `stepAt`, never the computer's own),
 * which of the slide's elements is the deck's picture (the screens draw the step there), the still a step ends on
 * (the stage's next, a phone, a thumbnail), and the files a deck's slide draws or sounds (what a node copies ahead
 * and the outputs load ahead). The engine's side is main/engine/deck-steps.ts; the screens' render/DeckStep.tsx.
 */

/** The last step of a slide's deck (0 for a slide with no deck). */
export const lastStep = (deck: DeckSlide | undefined): number => stepCount(deck) - 1;

/** The deck's step `index`, kept within its steps; undefined for a slide with no deck, or one saved with none. */
export function deckStep(deck: DeckSlide | undefined, index: number): DeckStep | undefined {
  if (!deck || deck.steps.length === 0) return undefined;
  return deck.steps[Math.min(Math.max(0, Math.floor(index)), deck.steps.length - 1)];
}

/** The step a slide layer shows: its own, never past its deck's last (0 for any other slide). */
export function stepOf(layer: Pick<SlideLayer, 'slide' | 'step'>): number {
  return Math.min(Math.max(0, layer.step ?? 0), lastStep(layer.slide.deck));
}

/** A Drashti transition that takes no time is a cut: left out, as the engine leaves a cut out of a slide layer. */
export function takingTime(t: Transition | undefined): Transition | undefined {
  return !t || t.kind === 'cut' || (t.durationMs <= 0 && t.kind !== 'zoom') ? undefined : t;
}

/** When the step a slide layer shows plays, by the engine's clock. */
export interface StepTiming {
  index: number;
  step: DeckStep;
  /** The engine's time at its clip's start (0 ms into it): it may be before the step was shown (`stepFromMs`). */
  clipAt: number;
  /** The engine's time its clip ends: its last frame is held from then, or its hold goes round from then. */
  endsAt: number;
  /** Shown at its last frame at once, with no motion (come back to by Back or Previous). */
  still: boolean;
  /**
   * Drashti's own transition into it (a step's, from 1, set in Drashti's editor), from when it was shown; only when
   * it came by Next (never come back to). Null when none.
   */
  drashti: DeckDrashtiTransition | null;
  /** When the step was shown (`stepAt`). */
  shownAt: number;
}

/** When a slide layer's step plays: null for a slide with no deck (or a deck saved with no steps). */
export function stepTiming(
  layer: Pick<SlideLayer, 'slide' | 'step' | 'stepAt' | 'stepFromMs' | 'shownAt'>,
): StepTiming | null {
  const deck = layer.slide.deck;
  const index = stepOf(layer);
  const step = deckStep(deck, index);
  if (!deck || !step) return null;
  const shownAt = layer.stepAt ?? layer.shownAt;
  const from = Math.max(0, layer.stepFromMs ?? 0);
  const clipAt = shownAt - from;
  const own = index > 0 && from === 0 ? deck.stepTransitions?.[index] : undefined;
  return {
    index,
    step,
    clipAt,
    endsAt: clipAt + Math.max(0, step.clipMs),
    still: from >= step.clipMs,
    drashti: own && takingTime(own.transition) ? own : null,
    shownAt,
  };
}

/**
 * The element that draws a deck's picture: the slide's picture of one of its steps' last frames (the import makes the
 * slide's picture its last step's), else its first picture. The screens draw the step showing in its place; a
 * thumbnail draws it as it is (the slide whole). Null for a slide with no deck or no picture.
 */
export function deckPictureId(slide: RenderSlide): string | null {
  const deck = slide.deck;
  if (!deck) return null;
  const lasts = new Set(deck.steps.map((s) => s.lastId));
  const pictures = slide.elements.filter((e) => e.kind === 'image');
  return (pictures.find((e) => e.kind === 'image' && lasts.has(e.mediaId)) ?? pictures[0])?.id ?? null;
}

/**
 * The slide as step `index` ends: its picture that step's last frame (the stage's next, a phone's next, LIVE's next).
 * The same slide when it has no deck.
 */
export function deckSlideAt(slide: RenderSlide, index: number): RenderSlide {
  const id = deckPictureId(slide);
  const last = deckStep(slide.deck, index)?.lastId;
  if (id === null || !last) return slide;
  return {
    ...slide,
    elements: slide.elements.map((e) => (e.id === id && e.kind === 'image' ? { ...e, mediaId: last } : e)),
  };
}

/** The deck's own entry for one of its videos or sounds, by its file. */
export function deckMediaOf(
  slide: RenderSlide,
  mediaId: string,
  kind?: DeckMedia['kind'],
): DeckMedia | undefined {
  return slide.deck?.media.find((m) => m.mediaId === mediaId && (kind === undefined || m.kind === kind));
}

/** Where the deck's videos and sounds play between (its trims), by file: the engine stamps these, not the library's. */
export function deckClips(deck: DeckSlide | undefined): VideoClips {
  const clips: VideoClips = {};
  for (const m of deck?.media ?? []) if (m.clip) clips[m.mediaId] = m.clip;
  return clips;
}

/**
 * The pictures and videos a deck's slide draws: each step's clip, last frame and hold, and its videos and their
 * posters. A node copies them ahead, as any slide's media (§26).
 */
export function deckPictures(deck: DeckSlide | undefined): string[] {
  const ids = new Set<string>();
  for (const s of deck?.steps ?? []) {
    ids.add(s.clipId);
    ids.add(s.lastId);
    if (s.holdId) ids.add(s.holdId);
  }
  for (const m of deck?.media ?? []) {
    if (m.kind === 'video') ids.add(m.mediaId);
    if (m.posterId) ids.add(m.posterId);
  }
  return [...ids];
}

/** The sounds a deck's slide plays: its sounds and its transition's sound (Main's audio player plays them). */
export function deckSounds(deck: DeckSlide | undefined): string[] {
  const ids = new Set<string>();
  for (const m of deck?.media ?? []) if (m.kind === 'audio') ids.add(m.mediaId);
  if (deck?.transition?.soundId) ids.add(deck.transition.soundId);
  return [...ids];
}

/** What a step loads ahead: its clip and hold (videos), and its last frame (a picture). */
export function stepMedia(step: DeckStep | undefined): { mediaId: string; media: 'image' | 'video' }[] {
  if (!step) return [];
  return [
    { mediaId: step.clipId, media: 'video' },
    { mediaId: step.lastId, media: 'image' },
    ...(step.holdId ? [{ mediaId: step.holdId, media: 'video' as const }] : []),
  ];
}
