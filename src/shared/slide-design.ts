import type { RenderSlide, SlideDesign } from './model';
import type { EditDoc, EditSlide } from './slide-edit';
import { slideCanvas } from './document-page';
import { fitElements } from './slide-size';
import type { Size } from './scaling';

/** Resolve the one master once, before sending a slide to any screen, node, phone or stream. */
export function composeSlide(
  slide: RenderSlide,
  design: SlideDesign | undefined,
  master: EditSlide | null | undefined,
  ownsBackground = false,
  masterCanvas?: Size,
): RenderSlide {
  const own = slide.elements.some((element) => element.hidden)
    ? { ...slide, elements: slide.elements.filter((element) => !element.hidden) }
    : slide;
  if (own.deck) return own;
  const behind = design?.skipMaster ? null : master;
  const backdrop =
    design?.backdrop ?? (slide.background === null && !ownsBackground ? behind?.design?.backdrop : undefined);
  if (!design && !behind) return own;
  const masterElements = behind?.elements.filter((element) => !element.hidden) ?? [];
  return {
    ...own,
    background: slide.background ?? (ownsBackground ? null : behind?.background) ?? null,
    ...(backdrop ? { backdrop } : {}),
    ...(behind
      ? {
          elements: [
            ...fitElements(masterElements, masterCanvas ?? slide, slide).map((el) =>
              el.kind === 'text' ? { ...el, everyScreen: true } : el,
            ),
            ...own.elements,
          ],
          masterElementIds: masterElements.map((el) => el.id),
        }
      : {}),
    fullSlide: true,
  };
}

export function renderEditedSlide(doc: EditDoc, slide: EditSlide): RenderSlide {
  const own: RenderSlide = {
    id: slide.id,
    ...slideCanvas(slide, doc),
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
    slideCanvas(doc.master ?? undefined, doc),
  );
}

/** Compare what the master actually contributes, excluding editor metadata and hidden backgrounds. */
export function masterContribution(doc: EditDoc, slide: EditSlide): unknown {
  const behind = slide.design?.skipMaster || doc.master?.id === slide.id ? null : doc.master;
  const rendered = composeSlide(
    { id: slide.id, ...slideCanvas(slide, doc), background: slide.background, elements: [] },
    slide.design,
    behind,
    slide.cues.some((cue) => cue.kind === 'background'),
    slideCanvas(behind ?? undefined, doc),
  );
  return {
    elements: rendered.elements,
    background: rendered.background,
    backdrop: rendered.backdrop,
    cues: behind?.cues ?? [],
  };
}
