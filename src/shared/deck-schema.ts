import { z } from 'zod';
import type { DeckDrashtiTransition, DeckMedia, DeckSlide } from './deck';
import { MEDIA_ID_PATTERN } from './media';
import { transitionSchema } from './model-schema';

/*
 * A deck's slide (Session 54, C2; shared/deck.ts) checked as it crosses into the main process: in the slide editor's
 * document (shared/slide-edit.ts), where Drashti's own transitions on a deck's slide and its clicks are set, and as
 * stored (the slides' `deck` column C2's import keeps). What the editor saves of it is only those transitions
 * (main/library/slides.ts): the rest stays as the import stored it.
 */

/** A length of time in a deck (ms): never negative, never more than a day. */
const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600 * 1000);
const mediaId = z.string().regex(MEDIA_ID_PATTERN);
/** A place on the slide, as a fraction of its width or height (a little outside it allowed, as PowerPoint does). */
const fraction = z.number().min(-1).max(2);

/** Drashti's own transition on a deck's slide or click: over its own, or instead of it. */
export const deckDrashtiSchema: z.ZodType<DeckDrashtiTransition> = z.object({
  transition: transitionSchema,
  mode: z.enum(['over', 'instead']),
});

const mediaSchema: z.ZodType<DeckMedia> = z.object({
  kind: z.enum(['video', 'audio']),
  mediaId,
  box: z.object({ x: fraction, y: fraction, w: fraction, h: fraction }),
  posterId: mediaId.optional(),
  clip: z.object({ startMs: ms, endMs: ms.nullable() }).optional(),
  loop: z.boolean(),
  volume: z.number().min(0).max(1),
  muted: z.boolean().optional(),
  fadeInMs: ms.optional(),
  fadeOutMs: ms.optional(),
  start: z.union([
    z.object({ step: z.number().int().min(0).max(10_000), offsetMs: ms }),
    z.object({ clicked: z.literal(true) }),
  ]),
  acrossSlides: z.number().int().min(1).max(10_000).optional(),
  hideWhenStopped: z.boolean().optional(),
});

export const deckSlideSchema: z.ZodType<DeckSlide> = z.object({
  transition: z.object({ name: z.string().max(100), durationMs: ms, soundId: mediaId.optional() }).optional(),
  deckAdvanceMs: ms.optional(),
  steps: z
    .array(
      z.object({
        clipId: mediaId,
        clipMs: ms,
        transitionMs: ms.optional(),
        lastId: mediaId,
        holdId: mediaId.optional(),
        holdMs: ms.optional(),
      }),
    )
    .max(1000),
  media: z.array(mediaSchema).max(200),
  drashti: deckDrashtiSchema.optional(),
  stepTransitions: z.record(z.string().regex(/^[1-9]\d{0,3}$/u), deckDrashtiSchema).optional(),
});

/** A deck's slide as stored (JSON), or undefined when there is none or it does not read as one. */
export function deckFromJson(text: string | null | undefined): DeckSlide | undefined {
  if (!text) return undefined;
  try {
    const parsed = deckSlideSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
