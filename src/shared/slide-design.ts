import type { RenderSlide, SlideDesign } from './model';
import type { EditDoc, EditSlide } from './slide-edit';
import { editingCanvas } from './document-page';

/** Resolve the one master once, before sending a slide to any screen, node, phone or stream. */
export function composeSlide(
  slide: RenderSlide,
  design: SlideDesign | undefined,
  master: EditSlide | null | undefined,
  ownsBackground = false,
): RenderSlide {
  if (slide.deck) return slide;
  const behind = design?.skipMaster ? null : master;
  const backdrop =
    design?.backdrop ?? (slide.background === null && !ownsBackground ? behind?.design?.backdrop : undefined);
  if (!design && !behind) return slide;
  return {
    ...slide,
    background: slide.background ?? (ownsBackground ? null : behind?.background) ?? null,
    ...(backdrop ? { backdrop } : {}),
    ...(behind
      ? {
          elements: [
            ...behind.elements.map((el) => (el.kind === 'text' ? { ...el, everyScreen: true } : el)),
            ...slide.elements,
          ],
          masterElementIds: behind.elements.map((el) => el.id),
        }
      : {}),
    fullSlide: true,
  };
}

export function renderEditedSlide(doc: EditDoc, slide: EditSlide): RenderSlide {
  const own: RenderSlide = {
    id: slide.id,
    ...editingCanvas(slide.documentPage, doc),
    background: slide.background,
    elements: slide.elements,
    ...(slide.darken ? { darken: slide.darken } : {}),
    ...(slide.deck ? { deck: slide.deck } : {}),
  };
  return composeSlide(
    own,
    slide.design,
    doc.master?.id === slide.id ? null : doc.master,
    slide.cues.some((c) => c.kind === 'background'),
  );
}
