import type { DeckSlide } from './deck';
import type { RenderSlide, ShapeElement, SlideElement } from './model';

export const PDF_MARK_NAMES = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strike through',
  draw: 'Draw',
  cover: 'Cover',
} as const;

export function isPdfMark(
  element: SlideElement,
): element is ShapeElement & { pdfMark: NonNullable<ShapeElement['pdfMark']> } {
  return element.kind === 'shape' && element.pdfMark !== undefined;
}

/** Stable ties keep copied marks deterministic; deleting or hiding one never leaves an empty Next. */
export function orderedPdfMarks(elements: readonly SlideElement[], includeHidden = false) {
  return elements
    .filter(isPdfMark)
    .filter((element) => (includeHidden || !element.hidden) && element.pdfMark.clickOrder !== undefined)
    .sort((a, b) => (a.pdfMark.clickOrder ?? 0) - (b.pdfMark.clickOrder ?? 0));
}

export const pdfMarkTarget = (id: string): string => `pdf-mark:${id}`;

/** Reuse the engine's one timeline for hall, stream, node, phones and Back. Never persist a second timeline. */
export function withPdfMarkMotion(slide: RenderSlide): RenderSlide {
  if (slide.deck) return slide;
  const marks = orderedPdfMarks(slide.elements);
  if (!marks.length) return slide;
  const deck: DeckSlide = {
    steps: [],
    media: [],
    motion: {
      approximate: false,
      stepsMs: [0, ...marks.map(() => 0)],
      effects: marks.map((mark, index) => ({
        shapeId: pdfMarkTarget(mark.id),
        step: index + 1,
        phase: 'in',
        kind: 'appear',
        delayMs: 0,
        durationMs: 0,
      })),
    },
  };
  return {
    ...slide,
    // A mark waiting for Next must not finish its old timed fade before that click.
    // Keep the saved timing intact, so turning the click choice off restores it.
    elements: slide.elements.map((element) => {
      if (!isPdfMark(element) || element.pdfMark.clickOrder === undefined || !element.motion) return element;
      const { motion: _timed, ...mark } = element;
      return mark;
    }),
    deck,
  };
}
