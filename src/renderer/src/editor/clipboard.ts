import { slideCanvas } from '../../../shared/document-page';
import type { Outline, Rect, SlideElement, TextShadow } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { findSlide, mapSlide, newId } from './ops';
import { freshGroups } from '../../../shared/element-groups';

/*
 * The slide editor's clipboard (Copy, Cut, Paste, Paste in place): elements
 * as they are, with their styles, their words' languages and the media they
 * show (the same library, so the same files). Kept while the window is open,
 * so it works between slides and between presentations. Pasted elements get
 * new ids. Paste puts them where they were, or a little down and to the
 * right when that place is taken (pasting on the same slide); Paste in place
 * always puts them where they were. Into a presentation of another size they
 * keep their place and size in proportion, their words scaled with them.
 */

export interface Copied {
  elements: SlideElement[];
  /** The size of the slides they came from. */
  width: number;
  height: number;
}

let copied: Copied | null = null;

/**
 * Since Session 55 (Part 17a) the editor has a window of its own, made for each presentation edited: what is copied is
 * kept by the main process too (its window's page says so here), so it pastes into the next presentation's slides.
 */
let keep: ((c: Copied) => void) | null = null;

/** Where copies are kept besides this page (the editor's window: the main process). */
export function keepCopiesWith(kept: (c: Copied) => void): void {
  keep = kept;
}

/** What was copied in an editor window before this one (the main process kept it). */
export function setCopied(c: Copied | null): void {
  copied = c === null ? null : structuredClone(c);
}

/** How far Paste moves elements whose place is taken (slide pixels). */
const OFFSET = 24;

/** Copy these elements of a slide (bottom to top, as they are drawn). */
export function copyElements(doc: EditDoc, slideId: string, ids: readonly string[]): number {
  const slide = findSlide(doc, slideId);
  const elements = slide?.elements.filter((el) => ids.includes(el.id)) ?? [];
  if (elements.length === 0) return 0;
  copied = { elements: structuredClone(elements), ...slideCanvas(slide, doc) };
  keep?.(copied);
  return elements.length;
}

export const hasCopied = (): boolean => copied !== null && copied.elements.length > 0;

const r2 = (n: number) => Math.round(n * 100) / 100;

function scaledShadow(shadow: TextShadow, k: number): TextShadow {
  return typeof shadow === 'boolean'
    ? shadow
    : { ...shadow, blur: r2(shadow.blur * k), x: r2(shadow.x * k), y: r2(shadow.y * k) };
}

/** An element on slides of another size: its frame in proportion, its words and lines scaled with the height. */
function rescaled(el: SlideElement, sx: number, sy: number): SlideElement {
  const frame: Rect = {
    x: r2(el.frame.x * sx),
    y: r2(el.frame.y * sy),
    width: r2(el.frame.width * sx),
    height: r2(el.frame.height * sy),
  };
  if (el.kind === 'text') {
    const k = sy;
    return {
      ...el,
      frame,
      style: {
        ...el.style,
        fontSize: r2(el.style.fontSize * k),
        shadow: scaledShadow(el.style.shadow, k),
        ...(el.style.outline
          ? { outline: { ...el.style.outline, width: r2(el.style.outline.width * k) } }
          : {}),
      },
      ...(el.runs
        ? {
            runs: el.runs.map((run) => ({
              ...run,
              ...(run.size !== undefined ? { size: r2(run.size * k) } : {}),
              ...(run.letterSpacing !== undefined ? { letterSpacing: r2(run.letterSpacing * k) } : {}),
            })),
          }
        : {}),
    };
  }
  // A Timer (Session 50): its digits, shadow and outline with the height, as words.
  if (el.kind === 'timer') {
    const k = sy;
    const outline: Outline | null | undefined = el.style.outline;
    return {
      ...el,
      frame,
      style: {
        ...el.style,
        fontSize: r2(el.style.fontSize * k),
        shadow: scaledShadow(el.style.shadow, k),
        ...(outline ? { outline: { ...outline, width: r2(outline.width * k) } } : {}),
      },
    };
  }
  if (el.kind === 'shape')
    return {
      ...el,
      frame,
      cornerRadius: r2(el.cornerRadius * Math.min(sx, sy)),
      ...(el.outline ? { outline: { ...el.outline, width: r2(el.outline.width * Math.min(sx, sy)) } } : {}),
    };
  return { ...el, frame };
}

const sameFrame = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/** Paste onto a slide, on top of what is there: the new document and the pasted elements' ids, or null. */
export function pasteElements(
  doc: EditDoc,
  slideId: string,
  { inPlace = false }: { inPlace?: boolean } = {},
): { doc: EditDoc; ids: string[] } | null {
  const slide = findSlide(doc, slideId);
  if (!copied || !slide) return null;
  const size = slideCanvas(slide, doc);
  const sx = size.width / copied.width;
  const sy = size.height / copied.height;
  let elements = freshGroups(
    copied.elements.map((el): SlideElement => ({
      ...(sx === 1 && sy === 1 ? structuredClone(el) : rescaled(structuredClone(el), sx, sy)),
      id: newId(),
    })),
  );
  if (!inPlace) {
    // Taken places (pasting where they came from): a step down and to the right until free.
    for (let step = 0; step < 20; step++) {
      const taken = elements.some((el) => slide.elements.some((other) => sameFrame(other.frame, el.frame)));
      if (!taken) break;
      elements = elements.map((el) => ({
        ...el,
        frame: { ...el.frame, x: el.frame.x + OFFSET, y: el.frame.y + OFFSET },
      }));
    }
  }
  return {
    doc: mapSlide(doc, slideId, (s) => ({ ...s, elements: [...s.elements, ...elements] })),
    ids: elements.map((el) => el.id),
  };
}
