import type { DeckSlide } from './deck';

export const DECK_MOTION_APPROXIMATION =
  'When you save this edit, Drashti will use the closest effects it can play. Check the slide’s clicks and transition before going live.';

/** Keep the source timeline while letting the saved objects take over from the PowerPoint video. */
export function deckAfterEdit(deck: DeckSlide | undefined, chosen = deck): DeckSlide | undefined {
  if (!deck?.motion) return undefined;
  const {
    after: _after,
    sourceStillId: _sourceStill,
    preparing: _preparing,
    drashti: _drashti,
    stepTransitions: _stepTransitions,
    ...source
  } = deck;
  const transitionMs = deck.steps[0]?.transitionMs ?? 0;
  return {
    ...source,
    steps: [],
    media: source.media.map((media) =>
      'step' in media.start && media.start.step === 0 && transitionMs > 0
        ? { ...media, start: { step: 0, offsetMs: Math.max(0, media.start.offsetMs - transitionMs) } }
        : media,
    ),
    ...(chosen?.drashti ? { drashti: chosen.drashti } : {}),
    ...(chosen?.stepTransitions ? { stepTransitions: chosen.stepTransitions } : {}),
  };
}
