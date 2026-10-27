import { z } from 'zod';
import type { DeckSlide } from './deck';
import { idSchema, transitionSchema } from './model-schema';

/*
 * A deck's slide as stored (Session 54, C2): a slide's `deck` column (migration 50) holds shared/deck.ts's DeckSlide
 * as JSON, NULL for every other slide. Read back through this schema, so a value that does not read is a slide
 * without its deck (its picture, the last step's last frame, still shows), never an error. Fields this Drashti does
 * not know are kept as they are (a newer Drashti's), as an element's unknown data is (library/slides.ts).
 */

/** A length or a moment in ms: whole, never below 0, at most a day. */
const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600 * 1000);

/** A fraction of the slide's width or height (a box may hang off the slide, as PowerPoint lets it). */
const fraction = z.number().min(-10).max(10);

const stepSchema = z.looseObject({
  clipId: idSchema,
  clipMs: ms,
  transitionMs: ms.optional(),
  lastId: idSchema,
  holdId: idSchema.optional(),
  holdMs: ms.optional(),
});

const startSchema = z.union([
  z.looseObject({ step: z.number().int().min(0).max(10_000), offsetMs: ms }),
  z.looseObject({ clicked: z.literal(true) }),
]);

const mediaSchema = z.looseObject({
  kind: z.enum(['video', 'audio']),
  mediaId: idSchema,
  box: z.object({ x: fraction, y: fraction, w: fraction.nonnegative(), h: fraction.nonnegative() }),
  posterId: idSchema.optional(),
  clip: z.object({ startMs: ms, endMs: ms.nullable() }).optional(),
  loop: z.boolean(),
  volume: z.number().min(0).max(1),
  muted: z.boolean().optional(),
  fadeInMs: ms.optional(),
  fadeOutMs: ms.optional(),
  start: startSchema,
  acrossSlides: z.number().int().min(1).max(10_000).optional(),
  hideWhenStopped: z.boolean().optional(),
});

export const deckSlideSchema = z.looseObject({
  transition: z
    .looseObject({ name: z.string().min(1).max(200), durationMs: ms, soundId: idSchema.optional() })
    .optional(),
  deckAdvanceMs: ms.optional(),
  steps: z.array(stepSchema).max(10_000),
  media: z.array(mediaSchema).max(1000),
  drashti: z.object({ transition: transitionSchema, mode: z.enum(['over', 'instead']) }).optional(),
  // Each click's own, over its motion or instead of it (C2's show: the slide editor sets both).
  stepTransitions: z
    .record(
      z.string().regex(/^\d{1,5}$/u),
      z.object({ transition: transitionSchema, mode: z.enum(['over', 'instead']) }),
    )
    .optional(),
});

/** A slide's deck as stored, or null for none (and for one that does not read). */
export function deckFromJson(json: string | null | undefined): DeckSlide | null {
  if (!json) return null;
  try {
    const parsed = deckSlideSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A slide's deck as it is stored: JSON, or null for a slide made from no deck. */
export function deckToJson(deck: DeckSlide | null | undefined): string | null {
  return deck ? JSON.stringify(deck) : null;
}

/** Every media item a deck's slide uses: its steps' clips, last frames and holds, its media and their posters. */
export function deckMediaIds(deck: DeckSlide): string[] {
  const ids = new Set<string>();
  for (const s of deck.steps) {
    ids.add(s.clipId);
    ids.add(s.lastId);
    if (s.holdId) ids.add(s.holdId);
  }
  for (const m of deck.media) {
    ids.add(m.mediaId);
    if (m.posterId) ids.add(m.posterId);
  }
  if (deck.transition?.soundId) ids.add(deck.transition.soundId);
  return [...ids];
}

/** The same deck with every media id `swap` gives (an import's references made library ids, or a copy's). */
export function mapDeckMedia(deck: DeckSlide, swap: (id: string) => string): DeckSlide {
  return {
    ...deck,
    ...(deck.transition
      ? {
          transition: {
            ...deck.transition,
            ...(deck.transition.soundId ? { soundId: swap(deck.transition.soundId) } : {}),
          },
        }
      : {}),
    steps: deck.steps.map((s) => ({
      ...s,
      clipId: swap(s.clipId),
      lastId: swap(s.lastId),
      ...(s.holdId ? { holdId: swap(s.holdId) } : {}),
    })),
    media: deck.media.map((m) => ({
      ...m,
      mediaId: swap(m.mediaId),
      ...(m.posterId ? { posterId: swap(m.posterId) } : {}),
    })),
  };
}
