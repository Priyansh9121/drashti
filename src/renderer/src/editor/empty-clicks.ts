import { type DeckSlide, nativeDeckMotion } from '../../../shared/deck';
import {
  builtParagraphEffects,
  deckElementTargets,
  deckParagraphEffects,
  deckParagraphRuns,
} from '../../../shared/deck-motion';
import { takingTime } from '../../../shared/deck-show';
import type { SlideElement } from '../../../shared/model';

/** Clicks with no surviving target in the editable slide's motion. */
export function emptyClicks(deck: DeckSlide, elements: readonly SlideElement[]): number[] {
  const motion = nativeDeckMotion(deck);
  if (!motion) return [];

  const used = new Set<number>();
  for (const [step, own] of Object.entries(deck.stepTransitions ?? {})) {
    if (takingTime(own.transition)) used.add(Number(step));
  }
  // A deck video plays through its visible object. A deck sound has no such object.
  const videos = new Set(
    elements.flatMap((element) => (element.kind === 'video' && !element.hidden ? [element.mediaId] : [])),
  );
  for (const { start, kind, mediaId } of deck.media) {
    if ('step' in start && (kind === 'audio' || videos.has(mediaId))) used.add(start.step);
  }
  const targets = new Set<string>();
  const builds = deckParagraphEffects(motion.effects);
  for (const element of elements) {
    if (element.hidden) continue;
    const cut = element.kind === 'text' ? deckParagraphRuns(element) : null;
    const paragraphs = cut
      ? new Set(cut.paragraphs.filter((_, index) => cut.runs[index]?.text.trim()))
      : null;
    if (paragraphs?.size === 0) continue;
    for (const target of deckElementTargets(element)) targets.add(target);
    const effects = element.sourceShapeId ? builds.get(element.sourceShapeId) : undefined;
    if (paragraphs && effects) {
      for (const paragraph of paragraphs)
        for (const effect of builtParagraphEffects(effects, paragraph)) used.add(effect.step);
    }
  }
  for (const effect of motion.effects) {
    if (!effect.paragraphs && targets.has(effect.shapeId)) used.add(effect.step);
  }
  return motion.stepsMs.flatMap((_, step) => (step > 0 && !used.has(step) ? [step] : []));
}
