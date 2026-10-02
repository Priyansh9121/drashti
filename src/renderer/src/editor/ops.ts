import type {
  Lang,
  MediaElement,
  Outline,
  ShapeElement,
  SlideElement,
  TextAlign,
  TextElement,
  TextRun,
  TextShadow,
  VerticalAlign,
} from '../../../shared/model';
import type { EditDoc, EditSlide, SlideLook } from '../../../shared/slide-edit';
import { mainLang } from '../../../shared/text-runs';
import { boundsOf, type Point } from './geometry';

/*
 * What the slide editor does to its document, as pure functions: each
 * returns a new document (or element) and leaves the old one as it was, so
 * Undo is keeping the old one.
 */

/** A fresh id for something new (the main process gives it its stored id when saved). */
export const newId = (): string => crypto.randomUUID();

export function findSlide(doc: EditDoc, slideId: string | null): EditSlide | undefined {
  if (slideId === null) return undefined;
  for (const g of doc.groups) for (const s of g.slides) if (s.id === slideId) return s;
  return undefined;
}

export function mapSlide(doc: EditDoc, slideId: string, fn: (slide: EditSlide) => EditSlide): EditDoc {
  return {
    ...doc,
    groups: doc.groups.map((g) =>
      g.slides.some((s) => s.id === slideId)
        ? { ...g, slides: g.slides.map((s) => (s.id === slideId ? fn(s) : s)) }
        : g,
    ),
  };
}

/** Change some elements of a slide. */
export function mapElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  fn: (el: SlideElement) => SlideElement,
): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => ({
    ...s,
    elements: s.elements.map((el) => (set.has(el.id) ? fn(el) : el)),
  }));
}

const round = (n: number) => Math.round(n * 100) / 100;

export function moveElements(doc: EditDoc, slideId: string, ids: readonly string[], d: Point): EditDoc {
  return mapElements(doc, slideId, ids, (el) => ({
    ...el,
    frame: { ...el.frame, x: round(el.frame.x + d.x), y: round(el.frame.y + d.y) },
  }));
}

/** Move each element by its own amount (lining up and spacing out). */
export function moveEach(doc: EditDoc, slideId: string, moves: ReadonlyMap<string, Point>): EditDoc {
  return mapElements(doc, slideId, [...moves.keys()], (el) => {
    const d = moves.get(el.id) ?? { x: 0, y: 0 };
    return { ...el, frame: { ...el.frame, x: round(el.frame.x + d.x), y: round(el.frame.y + d.y) } };
  });
}

export function deleteElements(doc: EditDoc, slideId: string, ids: readonly string[]): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => ({ ...s, elements: s.elements.filter((el) => !set.has(el.id)) }));
}

/** Put a new element on top of the others. */
export function addElement(doc: EditDoc, slideId: string, el: SlideElement): EditDoc {
  return mapSlide(doc, slideId, (s) => ({ ...s, elements: [...s.elements, el] }));
}

/** Copies of some elements, a little down and to the right, on top; returns the copies' ids. */
export function duplicateElements(
  doc: EditDoc,
  slideId: string,
  ids: readonly string[],
  offset = 24,
): { doc: EditDoc; ids: string[] } {
  const slide = findSlide(doc, slideId);
  if (!slide) return { doc, ids: [] };
  const copies = slide.elements
    .filter((el) => ids.includes(el.id))
    .map((el) => ({
      ...structuredClone(el),
      id: newId(),
      frame: { ...el.frame, x: el.frame.x + offset, y: el.frame.y + offset },
    }));
  return {
    doc: mapSlide(doc, slideId, (s) => ({ ...s, elements: [...s.elements, ...copies] })),
    ids: copies.map((c) => c.id),
  };
}

export type Arrange = 'front' | 'forward' | 'backward' | 'back';

/** Bring elements to the front or one step forward, or send them back (the order is bottom to top). */
export function arrange(doc: EditDoc, slideId: string, ids: readonly string[], how: Arrange): EditDoc {
  const set = new Set(ids);
  return mapSlide(doc, slideId, (s) => {
    const list = [...s.elements];
    if (how === 'front' || how === 'back') {
      const moving = list.filter((el) => set.has(el.id));
      const rest = list.filter((el) => !set.has(el.id));
      return { ...s, elements: how === 'front' ? [...rest, ...moving] : [...moving, ...rest] };
    }
    // One step: each chosen element swaps with the next one that is not chosen.
    const step = how === 'forward' ? 1 : -1;
    const order = list.map((_, i) => i);
    if (step > 0) order.reverse();
    for (const i of order) {
      const j = i + step;
      const a = list[i];
      const b = list[j];
      if (a && b && set.has(a.id) && !set.has(b.id)) [list[i], list[j]] = [b, a];
    }
    return { ...s, elements: list };
  });
}

// ---- new elements in the presentation's look ------------------------------------------

/** A new, empty text box in the theme's place and style. */
export function newTextBox(look: SlideLook): TextElement {
  return {
    id: newId(),
    kind: 'text',
    frame: { ...look.frame },
    text: '',
    lang: null,
    style: { ...look.style },
  };
}

export type ShapeChoice = 'rectangle' | 'rounded' | 'ellipse' | 'line';

/**
 * A new shape in the middle of the slide: a dark see-through box (behind
 * words), a rounded one or an ellipse; a line in the theme's text colour.
 */
export function newShape(
  choice: ShapeChoice,
  look: SlideLook,
  size: { width: number; height: number },
): ShapeElement {
  const width = Math.round(size.width * 0.4);
  const height = choice === 'line' ? 20 : Math.round(size.height * 0.3);
  const frame = {
    x: Math.round((size.width - width) / 2),
    y: Math.round((size.height - height) / 2),
    width,
    height,
  };
  const base = { id: newId(), kind: 'shape' as const, frame, cornerRadius: 0, opacity: 1 };
  if (choice === 'line')
    return { ...base, shape: 'line', fill: null, outline: { color: look.style.color, width: 6 } };
  return {
    ...base,
    ...(choice === 'ellipse' ? { shape: 'ellipse' as const } : { shape: 'rectangle' as const }),
    fill: '#000000',
    opacity: 0.6,
    cornerRadius: choice === 'rounded' ? Math.round(Math.min(width, height) * 0.12) : 0,
  };
}

/** A picture or video at its own proportions, half the slide wide at most, in the middle. */
export function newMedia(
  media: { id: string; kind: 'image' | 'video'; width?: number; height?: number },
  size: { width: number; height: number },
): MediaElement {
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  let width = size.width * 0.5;
  let height = width / ratio;
  if (height > size.height * 0.6) {
    height = size.height * 0.6;
    width = height * ratio;
  }
  return {
    id: newId(),
    kind: media.kind,
    frame: {
      x: Math.round((size.width - width) / 2),
      y: Math.round((size.height - height) / 2),
      width: Math.round(width),
      height: Math.round(height),
    },
    mediaId: media.id,
    fit: 'fit',
    ...(media.kind === 'video' ? { loop: true } : {}),
  };
}

// ---- text styles for a whole box --------------------------------------------------------

/** A change to how text looks: a value sets it, undefined goes back to the box's (or default). */
export interface TextPatch {
  font?: string | null | undefined;
  size?: number | undefined;
  weight?: number | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
  shadow?: TextShadow | undefined;
  outline?: Outline | null | undefined;
  lang?: Lang | null | undefined;
}

/** Box-only settings. */
export interface BoxPatch {
  align?: TextAlign;
  verticalAlign?: VerticalAlign;
  lineHeight?: number;
  shrinkToFit?: boolean;
}

/** The run fields each text setting writes. */
const RUN_KEYS: Record<keyof TextPatch, keyof TextRun> = {
  font: 'font',
  size: 'size',
  weight: 'weight',
  italic: 'italic',
  color: 'color',
  shadow: 'shadow',
  outline: 'outline',
  lang: 'lang',
};

/** A run look with a change: set keys, and drop the ones changed to undefined (so they follow the box). */
export function patchRun(run: TextRun, patch: TextPatch): TextRun {
  const changes = (Object.entries(patch) as [keyof TextPatch, unknown][]).map(
    ([k, v]) => [RUN_KEYS[k], v] as const,
  );
  const changed = new Set<string>(changes.map(([k]) => k));
  return Object.fromEntries([
    ...Object.entries(run).filter(([k]) => !changed.has(k)),
    ...changes.filter(([, v]) => v !== undefined),
  ]) as unknown as TextRun;
}

/**
 * The whole box in a new style: the box takes it, and its words stop
 * overriding it (they follow the box). Words in a legacy font keep their
 * font and language: they only read right in that font.
 */
export function styleBox(el: TextElement, patch: TextPatch, box: BoxPatch = {}): TextElement {
  const style = { ...el.style, ...box };
  if ('font' in patch) style.fontFamily = patch.font ?? null;
  if (patch.size !== undefined) style.fontSize = patch.size;
  if (patch.weight !== undefined) style.fontWeight = patch.weight;
  if (patch.color !== undefined) style.color = patch.color;
  if ('shadow' in patch) style.shadow = patch.shadow ?? false;
  if ('outline' in patch) {
    if (patch.outline) style.outline = patch.outline;
    else delete style.outline;
  }
  // Italic has no box setting: every word gets it. Everything else: the words follow the box.
  const forWords: TextPatch = {};
  for (const k of Object.keys(patch) as (keyof TextPatch)[]) {
    if (k === 'italic') forWords.italic = patch.italic ? true : undefined;
    else forWords[k] = undefined;
  }
  let runs = el.runs?.map((r) =>
    patchRun(r, r.legacy ? { ...forWords, font: r.font, lang: r.lang } : forWords),
  );
  if (patch.italic && (!runs || runs.length === 0)) runs = [{ text: el.text, italic: true }];
  const next: TextElement = { ...el, style };
  if ('lang' in patch) next.lang = patch.lang ?? null;
  if (runs?.some((r) => Object.keys(r).some((k) => k !== 'text'))) next.runs = runs;
  else delete next.runs;
  if (!('lang' in patch) && next.lang === null && runs) next.lang = mainLang(runs);
  return next;
}

/** Whether an element can be seen with its frame here: its upright bounds meet the slide. */
export const onSlide = (el: SlideElement, size: { width: number; height: number }): boolean => {
  const b = boundsOf(el);
  return b.x < size.width && b.y < size.height && b.x + b.width > 0 && b.y + b.height > 0;
};
