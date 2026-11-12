import type { DeckEffect, DeckMedia, DeckSlide } from './deck';
import { deckSlideSchema } from './deck-schema';
import type { PageSize } from './document-page';
import type { PreparedSourcePage } from './editable-source';
import type { MediaElement, Rect } from './model';
import type { EditSlide } from './slide-edit';

/*
 * W6's review N4 (Session 57). A PowerPoint deck slide imported before alpha.17 plays the clips of PowerPoint's movie
 * and has no clicks of its own (`deck.motion`). When Edit slides prepares it from the .pptx Drashti kept, the document
 * reader reads its clicks and transition as alpha.17's import does (main/documents/pptx-source-timing.ts), and Main
 * keeps them beside its clips as that import keeps them for a slide it leaves as video (applyNativePages). The edit
 * then keeps them (deck-edit-motion.ts): no question for an exact slide, the closest effects for another. A Keynote
 * deck's slide, an old .ppt's, one whose kept file is missing and one whose clicks or video shapes cannot be matched
 * to its clips stay as they were.
 */

/**
 * An unedited PowerPoint page with clips but no native clicks. The reader can try legacy videos without a source
 * shape. Timing is applied only once every video it plays names a distinct source shape.
 */
export function wantsSourceTiming(slide: EditSlide, allowLegacyVideos = false): boolean {
  const page = slide.documentPage;
  const deck = slide.deck;
  if (page?.ext !== 'pptx' || page.edited || !deck || deck.steps.length === 0 || deck.motion) return false;
  if (!deck.media.some((media) => media.kind === 'video')) return true;

  const available = new Map<string, number>();
  const counted = new Set<string>();
  for (const element of slide.elements) {
    if (element.kind !== 'video') continue;
    const id = allowLegacyVideos ? element.id : element.sourceShapeId;
    if (!id || counted.has(id)) continue;
    counted.add(id);
    available.set(element.mediaId, (available.get(element.mediaId) ?? 0) + 1);
  }
  return deck.media.every((media) => {
    if (media.kind !== 'video') return true;
    const left = available.get(media.mediaId) ?? 0;
    if (left === 0) return false;
    available.set(media.mediaId, left - 1);
    return true;
  });
}

function matchesVideoBox(box: DeckMedia['box'], frame: Rect, canvas: PageSize): boolean {
  // The old deck rounded its video frame to whole pixels. The editable source may use another canvas size.
  const tolerance = 2;
  return (
    Math.abs(frame.x - box.x * canvas.width) <= tolerance &&
    Math.abs(frame.y - box.y * canvas.height) <= tolerance &&
    Math.abs(frame.width - box.w * canvas.width) <= tolerance &&
    Math.abs(frame.height - box.h * canvas.height) <= tolerance
  );
}

/** Give legacy video elements their original drawing IDs only when every match is unambiguous. */
export function withSourceVideoShapes(
  slide: EditSlide,
  savedCanvas: PageSize,
  source: Pick<PreparedSourcePage, 'width' | 'height' | 'elements' | 'sourceVideoShapeIds'>,
): EditSlide {
  const deck = slide.deck;
  if (
    !deck ||
    !source.sourceVideoShapeIds?.length ||
    wantsSourceTiming(slide) ||
    !wantsSourceTiming(slide, true)
  )
    return slide;

  const sourceIds = new Set(source.sourceVideoShapeIds);
  const posters = source.elements.flatMap((element) =>
    element.kind === 'image' && element.sourceShapeId && sourceIds.has(element.sourceShapeId)
      ? [{ id: element.sourceShapeId, frame: element.frame }]
      : [],
  );
  const videos = slide.elements.filter((element): element is MediaElement => element.kind === 'video');
  const matched = new Map<string, string>();
  const usedShapes = new Set<string>();
  for (const media of deck.media) {
    if (media.kind !== 'video') continue;
    const stored = videos.filter(
      (video) => video.mediaId === media.mediaId && matchesVideoBox(media.box, video.frame, savedCanvas),
    );
    const pictures = posters.filter((poster) => matchesVideoBox(media.box, poster.frame, source));
    if (stored.length !== 1 || pictures.length !== 1) return slide;
    const video = stored[0];
    const picture = pictures[0];
    if (!video || !picture || matched.has(video.id) || usedShapes.has(picture.id)) return slide;
    if (video.sourceShapeId && video.sourceShapeId !== picture.id) return slide;
    matched.set(video.id, picture.id);
    usedShapes.add(picture.id);
  }
  return {
    ...slide,
    elements: slide.elements.map((element) => {
      const sourceShapeId = matched.get(element.id);
      return sourceShapeId ? { ...element, sourceShapeId } : element;
    }),
  };
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
        slide.documentPage?.sha256 === own && wantsSourceTiming(slide, true) ? [slide.documentPage.page] : [],
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
  zoomAway: true,
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
