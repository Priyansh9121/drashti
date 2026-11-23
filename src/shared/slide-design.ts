import { cropRenderedPage } from './pdf-page-crop';
import { nativeDeckMotion } from './deck';
import { hasPdfPageNumbers, numberedPdfMaster, PDF_HANDOUT_PREFIX } from './pdf-handout';
import { slidesOf } from './slide-edit';
import type { RenderSlide, SlideDesign } from './model';
import type { EditDoc, EditSlide } from './slide-edit';
import { slideCanvas, sourcePaperForCrop } from './document-page';
import { fitElements } from './slide-size';
import type { Size } from './scaling';
import { withPdfMarkMotion } from './pdf-mark-motion';

/** Resolve the one master once, before sending a slide to any screen, node, phone or stream. */
export function composeSlide(
  slide: RenderSlide,
  design: SlideDesign | undefined,
  master: EditSlide | null | undefined,
  ownsBackground = false,
  masterCanvas?: Size,
  pageIndex?: number,
): RenderSlide {
  const shown = slide.elements.some((element) => element.hidden)
    ? { ...slide, elements: slide.elements.filter((element) => !element.hidden) }
    : slide;
  const own = withPdfMarkMotion(shown);
  const nativeDeck = nativeDeckMotion(own.deck);
  if (own.deck && !nativeDeck) return own;
  const behind = design?.skipMaster ? null : numberedPdfMaster(master, pageIndex);
  const backdrop =
    design?.backdrop ?? (slide.background === null && !ownsBackground ? behind?.design?.backdrop : undefined);
  if (!design && !behind) return nativeDeck ? { ...own, fullSlide: true } : own;
  const masterElements = behind?.elements.filter((element) => !element.hidden) ?? [];
  return {
    ...own,
    background: slide.background ?? (ownsBackground ? null : behind?.background) ?? null,
    ...(backdrop ? { backdrop } : {}),
    ...(behind
      ? {
          elements: [
            ...fitElements(masterElements, masterCanvas ?? slide, slide).map((el) => {
              if (el.kind !== 'text') return el;
              if (!el.name?.startsWith(PDF_HANDOUT_PREFIX)) return { ...el, everyScreen: true };
              const original = masterElements.find((element) => element.id === el.id);
              if (original?.kind !== 'text') return { ...el, everyScreen: true };
              const canvas = masterCanvas ?? slide;
              const sx = slide.width / canvas.width,
                sy = slide.height / canvas.height;
              // Each edge's box follows its paper; its words grow or shrink by the paper's narrower change, so they
              // keep their size against their box (a watermark on a portrait page of a landscape PDF stays one line).
              return {
                ...el,
                everyScreen: true,
                frame: {
                  x: original.frame.x * sx,
                  y: original.frame.y * sy,
                  width: original.frame.width * sx,
                  height: original.frame.height * sy,
                },
                style: { ...el.style, fontSize: original.style.fontSize * Math.min(sx, sy) },
              };
            }),
            ...own.elements,
          ],
          masterElementIds: masterElements.map((el) => el.id),
        }
      : {}),
    fullSlide: true,
  };
}

export function renderEditedSlide(doc: EditDoc, slide: EditSlide, wholePage = false): RenderSlide {
  const own: RenderSlide = {
    id: slide.id,
    ...slideCanvas(slide, doc),
    background: slide.background,
    elements: slide.elements,
    ...(slide.darken ? { darken: slide.darken } : {}),
    ...(slide.deck ? { deck: slide.deck } : {}),
  };
  return cropRenderedPage(
    composeSlide(
      own,
      slide.design,
      doc.master?.id === slide.id ? null : doc.master,
      slide.cues.some((c) => c.kind === 'background'),
      slideCanvas(doc.master ?? undefined, doc),
      hasPdfPageNumbers(doc.master) ? slidesOf(doc).findIndex((page) => page.id === slide.id) : undefined,
    ),
    wholePage ? undefined : slide.documentPage?.crop,
    sourcePaperForCrop(slide.documentPage, slide.pageSize),
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
