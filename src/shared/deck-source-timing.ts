import type { DeckEffect, DeckSlide } from './deck';
import { deckSlideSchema } from './deck-schema';
import type { EditSlide } from './slide-edit';

/*
 * W6's review N4 (Session 57). A PowerPoint deck slide imported before alpha.17 plays the clips of PowerPoint's movie
 * and has no clicks of its own (`deck.motion`). When Edit slides prepares it from the .pptx Drashti kept, the document
 * reader reads its clicks and transition as alpha.17's import does (main/documents/pptx-source-timing.ts), and Main
 * keeps them beside its clips as that import keeps them for a slide it leaves as video (applyNativePages). The edit
 * then keeps them (deck-edit-motion.ts): no question for an exact slide, the closest effects for another. A Keynote
 * deck's slide, an old .ppt's, one with a video alpha.16 stored, one whose kept file is missing and one whose clicks
 * don't match its clips stay as they were: they lose their clicks when edited, as before.
 */

/**
 * Whether a slide's clicks are to be read from its kept file: a PowerPoint page, not yet edited, that plays
 * PowerPoint's clips with no clicks of its own, every video it plays an element of the slide that names its shape in
 * the deck (alpha.17's rows; alpha.16 stored a deck's videos with no shape, so such a video couldn't take its poster's
 * place after an edit, and the slide keeps today's behaviour: the review of 0663a204, HIGH-1).
 */
export function wantsSourceTiming(slide: EditSlide): boolean {
  const page = slide.documentPage;
  const deck = slide.deck;
  return (
    !!page &&
    page.ext === 'pptx' &&
    !page.edited &&
    !!deck &&
    deck.steps.length > 0 &&
    !deck.motion &&
    deck.media.every(
      (media) =>
        media.kind !== 'video' ||
        slide.elements.some(
          (element) =>
            element.kind === 'video' && element.mediaId === media.mediaId && !!element.sourceShapeId,
        ),
    )
  );
}

/**
 * The pages of `slides` whose clicks to read from the kept file, once each (SourceRead's `timingPages`): only pages of
 * the presentation's own .pptx, given its hash as the database holds it (a Keynote deck's slides name the PowerPoint
 * copy Keynote saved of it, never the deck itself, so they keep today's behaviour).
 */
export function sourceTimingPages(slides: readonly EditSlide[], sourceHash: unknown): number[] {
  const own = typeof sourceHash === 'string' ? sourceHash : null;
  return [
    ...new Set(
      slides.flatMap((slide) =>
        slide.documentPage?.sha256 === own && wantsSourceTiming(slide) ? [slide.documentPage.page] : [],
      ),
    ),
  ];
}

/** Every part of an effect Drashti knows (shared/deck.ts): the compiler holds this to `DeckEffect`'s own keys. */
const EFFECT_KEYS: Record<keyof DeckEffect, true> = {
  shapeId: true,
  step: true,
  phase: true,
  kind: true,
  delayMs: true,
  durationMs: true,
  accel: true,
  decel: true,
  direction: true,
  verticalDirection: true,
  degrees: true,
  fade: true,
  distance: true,
  splitAxis: true,
  scale: true,
  shape: true,
  inward: true,
  spokes: true,
  bars: true,
  paragraphs: true,
};

function knownEffect(effect: DeckEffect): DeckEffect {
  const known: Partial<Record<keyof DeckEffect, unknown>> = {};
  for (const key of Object.keys(EFFECT_KEYS) as (keyof DeckEffect)[])
    if (effect[key] !== undefined) known[key] = effect[key];
  return known as DeckEffect;
}

/**
 * A slide's clicks and transition as the document reader sent them, checked as a stored deck is (deckSlideSchema), with
 * only their known parts: the clicks (each effect's known keys), and the transition's name, length and the way Drashti
 * draws it, never a sound (the review of 0663a204, MEDIUM-1). Nothing when they don't read as clicks.
 */
export function sourceTimingDeck(value: unknown): DeckSlide | undefined {
  if (value === undefined) return undefined;
  const parsed = deckSlideSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { motion, transition, steps } = parsed.data;
  if (!motion || steps.length > 0) return undefined;
  return {
    steps: [],
    media: [],
    motion: {
      effects: motion.effects.map(knownEffect),
      stepsMs: [...motion.stepsMs],
      approximate: motion.approximate,
    },
    ...(transition
      ? {
          transition: {
            name: transition.name,
            durationMs: transition.durationMs,
            ...(transition.nativeTransition ? { nativeTransition: transition.nativeTransition } : {}),
          },
        }
      : {}),
  };
}

/**
 * The slide's deck with the clicks and transition read from its kept file (only their known parts), beside its clips,
 * as alpha.17's import keeps them for a slide it leaves as video. Left as it is unless the slide wants them
 * (wantsSourceTiming), and when they don't fit: its clicks must be its clips' clicks (the same Next and Back, the
 * same steps for its videos and sounds), and a file where nothing moves gives nothing.
 */
export function withSourceTiming(slide: EditSlide, read: DeckSlide | undefined): DeckSlide | undefined {
  const deck = slide.deck;
  const clicks = sourceTimingDeck(read);
  if (!deck || !clicks?.motion || !wantsSourceTiming(slide)) return deck;
  const motion = clicks.motion;
  if (motion.stepsMs.length !== deck.steps.length) return deck;
  const transition = clicks.transition;
  if (!transition && motion.stepsMs.length === 1 && motion.effects.length === 0 && !motion.approximate)
    return deck;
  const timed: DeckSlide = {
    ...deck,
    motion,
    ...(transition
      ? {
          transition: {
            ...transition,
            ...deck.transition,
            ...(transition.nativeTransition ? { nativeTransition: transition.nativeTransition } : {}),
          },
        }
      : {}),
  };
  return deckSlideSchema.safeParse(timed).success ? timed : deck;
}
