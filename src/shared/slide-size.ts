import type { Glow, Outline, Rect, SlideElement, TextRun, TextShadow, TextStyle } from './model';
import type { EditDoc, EditSlide, RunLook, SlideLook } from './slide-edit';
import { placeContent, type Size } from './scaling';
import { slideCanvas } from './document-page';

const shadowAt = (value: TextShadow, scale: number): TextShadow =>
  typeof value === 'boolean'
    ? value
    : {
        ...value,
        x: value.x * scale,
        y: value.y * scale,
        blur: value.blur * scale,
      };
const outlineAt = (value: Outline | null | undefined, scale: number) =>
  value ? { ...value, width: value.width * scale } : value;
const glowAt = (value: Glow | null | undefined, scale: number) =>
  value ? { ...value, size: value.size * scale } : value;

function styleAt(style: TextStyle, scale: number): TextStyle {
  return {
    ...style,
    fontSize: style.fontSize * scale,
    shadow: shadowAt(style.shadow, scale),
    ...(style.outline !== undefined ? { outline: outlineAt(style.outline, scale) } : {}),
    ...(style.glow !== undefined ? { glow: glowAt(style.glow, scale) } : {}),
  };
}

function runAt<T extends RunLook | TextRun>(run: T, scale: number): T {
  return {
    ...run,
    ...(run.size !== undefined ? { size: run.size * scale } : {}),
    ...(run.letterSpacing !== undefined ? { letterSpacing: run.letterSpacing * scale } : {}),
    ...(run.shadow !== undefined ? { shadow: shadowAt(run.shadow, scale) } : {}),
    ...(run.outline !== undefined ? { outline: outlineAt(run.outline, scale) } : {}),
    ...(run.glow !== undefined ? { glow: glowAt(run.glow, scale) } : {}),
  };
}

function scaledFrame(frame: Rect, from: Size, to: Size): Rect {
  const p = placeContent(from, to, 'fit');
  return {
    x: frame.x * p.scaleX + p.x,
    y: frame.y * p.scaleY + p.y,
    width: frame.width * p.scaleX,
    height: frame.height * p.scaleY,
  };
}

export function sizeLook(look: SlideLook, from: Size, to: Size): SlideLook {
  if (from.width === to.width && from.height === to.height) return look;
  const scale = placeContent(from, to, 'fit').scaleX;
  return {
    ...look,
    frame: scaledFrame(look.frame, from, to),
    style: styleAt(look.style, scale),
    langs: Object.fromEntries(Object.entries(look.langs).map(([lang, run]) => [lang, runAt(run, scale)])),
  };
}

function elementAt(el: SlideElement, from: Size, to: Size): SlideElement {
  const scale = placeContent(from, to, 'fit').scaleX;
  const frame = scaledFrame(el.frame, from, to);
  if (el.kind === 'text')
    return {
      ...el,
      frame,
      style: styleAt(el.style, scale),
      ...(el.runs ? { runs: el.runs.map((run) => runAt(run, scale)) } : {}),
    };
  if (el.kind === 'timer') return { ...el, frame, style: styleAt(el.style, scale) };
  if (el.kind === 'shape')
    return {
      ...el,
      frame,
      cornerRadius: el.cornerRadius * scale,
      ...(el.outline !== undefined ? { outline: outlineAt(el.outline, scale) } : {}),
    };
  return { ...el, frame };
}

/** Fit one set of objects without changing their identities, grouping or path coordinates. */
export function fitElements(elements: SlideElement[], from: Size, to: Size): SlideElement[] {
  if (from.width === to.width && from.height === to.height) return elements;
  return elements.map((element) => elementAt(element, from, to));
}

/** Fit each page from its own paper, or deliberately keep all pixel positions. */
export function resizePresentation(doc: EditDoc, to: Size, fit = true): EditDoc {
  if (![to.width, to.height].every((n) => Number.isInteger(n) && n >= 16 && n <= 16384)) return doc;
  const resize = (slide: EditSlide): EditSlide => {
    const from = slideCanvas(slide, doc);
    const changed = from.width !== to.width || from.height !== to.height;
    if (!changed) return slide;
    const p = placeContent(from, to, 'fit');
    return {
      ...slide,
      ...(slide.pageSize || slide.documentPage ? { pageSize: { ...to } } : {}),
      elements: fit ? fitElements(slide.elements, from, to) : slide.elements,
      ...(fit && slide.guides
        ? {
            guides: {
              x: slide.guides.x.map((x) => x * p.scaleX + p.x),
              y: slide.guides.y.map((y) => y * p.scaleY + p.y),
            },
          }
        : {}),
    };
  };
  const groups = doc.groups.map((group) => ({ ...group, slides: group.slides.map(resize) }));
  const master = doc.master ? resize(doc.master) : doc.master;
  if (
    doc.width === to.width &&
    doc.height === to.height &&
    master === doc.master &&
    groups.every((group, i) => group.slides.every((slide, j) => slide === doc.groups[i]?.slides[j]))
  )
    return doc;
  return { ...doc, ...to, groups, ...(doc.master ? { master } : {}) };
}
