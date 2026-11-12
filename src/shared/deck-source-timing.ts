import type { DeckSlide } from './deck';
import { deckSlideSchema } from './deck-schema';
import type { EditSlide } from './slide-edit';

/*
 * W6's review N4 (Session 57). A PowerPoint deck slide imported before alpha.17 plays the clips of PowerPoint's movie
 * and has no clicks of its own (`deck.motion`). When Edit slides prepares it from the .pptx Drashti kept, the document
 * reader reads its clicks and transition as alpha.17's import does (main/documents/pptx-source-timing.ts), and Main
 * keeps them beside its clips as that import keeps them for a slide it leaves as video (applyNativePages). The edit
 * then keeps them (deck-edit-motion.ts): no question for an exact slide, the closest effects for another. A Keynote
 * deck's slide, an old .ppt's, one whose kept file is missing and one whose clicks don't match its clips stay as they
 * were: they lose their clicks when edited, as before.
 */

/**
 * Whether a slide's clicks are to be read from its kept file: it plays PowerPoint's clips with no clicks of its own,
 * and its page is of the presentation's own .pptx (a Keynote deck's slides name the PowerPoint copy Keynote saved of
 * it, never the deck itself, so they keep today's behaviour).
 */
export function wantsSourceTiming(slide: EditSlide, sourceHash: string | null): boolean {
  const page = slide.documentPage;
  return (
    !!page &&
    page.ext === 'pptx' &&
    !page.edited &&
    page.sha256 === sourceHash &&
    !!slide.deck &&
    slide.deck.steps.length > 0 &&
    !slide.deck.motion
  );
}

/**
 * The pages of `slides` whose clicks to read from the kept file, once each (SourceRead's `timingPages`), given the
 * presentation's own file's hash as the database holds it.
 */
export function sourceTimingPages(slides: readonly EditSlide[], sourceHash: unknown): number[] {
  const own = typeof sourceHash === 'string' ? sourceHash : null;
  return [
    ...new Set(
      slides.flatMap((slide) =>
        slide.documentPage && wantsSourceTiming(slide, own) ? [slide.documentPage.page] : [],
      ),
    ),
  ];
}

/** A slide's clicks and transition as the document reader sent them, or nothing when they don't read as such. */
export function sourceTimingDeck(value: unknown): DeckSlide | undefined {
  if (value === undefined) return undefined;
  const parsed = deckSlideSchema.safeParse(value);
  return parsed.success && parsed.data.motion && parsed.data.steps.length === 0 ? parsed.data : undefined;
}

/**
 * The slide's deck with the clicks and transition read from its kept file, beside its clips, as alpha.17's import
 * keeps them for a slide it leaves as video. Left as it is when they don't fit: its clicks must be its clips' clicks
 * (the same Next and Back, the same steps for its videos and sounds), and a file where nothing moves gives nothing.
 */
export function withSourceTiming(
  deck: DeckSlide | undefined,
  read: DeckSlide | undefined,
): DeckSlide | undefined {
  if (!deck || !read?.motion || deck.motion || deck.steps.length === 0) return deck;
  const motion = read.motion;
  if (motion.stepsMs.length !== deck.steps.length) return deck;
  const transition = read.transition;
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
