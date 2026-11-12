import { z } from 'zod';
import type { Transition } from './model';

/** A PowerPoint transition that moves the whole slide, independently of the screen's Look. */
export interface DeckNativeTransition extends Transition {
  deckEffect: 'dissolve' | 'fade-black' | 'push' | 'wipe' | 'cover' | 'uncover' | 'zoom';
  direction?: 'left' | 'right' | 'up' | 'down';
}

export const deckNativeTransitionSchema: z.ZodType<DeckNativeTransition> = z.object({
  kind: z.enum(['dissolve', 'fade-black', 'slide', 'wipe', 'zoom-dissolve']),
  durationMs: z
    .number()
    .int()
    .positive()
    .max(24 * 3600 * 1000),
  deckEffect: z.enum(['dissolve', 'fade-black', 'push', 'wipe', 'cover', 'uncover', 'zoom']),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
});

export function isDeckNativeTransition(
  transition: Transition | undefined,
): transition is DeckNativeTransition {
  return transition !== undefined && 'deckEffect' in transition;
}
