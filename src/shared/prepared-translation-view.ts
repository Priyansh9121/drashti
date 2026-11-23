import type { Rect, RenderSlide, TextElement } from './model';
import type { TranslationLanguage } from './prepared-translations';
import { checkedText } from './prepared-translations';

export type TranslationChoice = 'off' | TranslationLanguage;
export interface TranslationDisplay {
  choice: TranslationChoice;
  groups: Record<string, TranslationChoice>;
  outputs: Record<string, TranslationChoice>;
  /** Deliberately reserved below the source box, in slide pixels. */
  area: Rect;
  fontSize: number;
}
export interface TranslationDestination {
  groupId?: string;
  outputId?: string;
  /** Overlays reserve everything below this point in slide coordinates. */
  blockedBelow?: number;
}
export function translationChoiceFor(
  display: TranslationDisplay | undefined,
  groupId?: string,
  outputId?: string,
): TranslationChoice {
  if (!display) return 'off';
  return (
    (outputId ? display.outputs[outputId] : undefined) ??
    (groupId ? display.groups[groupId] : undefined) ??
    display.choice
  );
}
export function translationSource(el: TextElement): string {
  return el.runs?.length ? el.runs.map((run) => run.text).join('') : el.text;
}
export function translationSourceSupported(el: TextElement, language: TranslationLanguage): boolean {
  return (
    !el.runs?.some((run) => run.legacy === true || (run.lang != null && run.lang !== language)) &&
    (el.lang == null || el.lang === language)
  );
}
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Conservative fit: two ems per grapheme, at most two lines, never reduce the chosen type size. */
export function translationFits(text: string, area: Rect, fontSize: number): boolean {
  const columns = Math.floor(area.width / (2 * fontSize));
  if (columns < 1 || fontSize <= 0 || !text.trim()) return false;
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const lines = text
    .split('\n')
    .reduce(
      (count, line) => count + Math.max(1, Math.ceil([...graphemes.segment(line)].length / columns)),
      0,
    );
  return lines <= 2 && lines * fontSize * 1.45 <= area.height;
}
export function translationLayoutProblem(
  slide: RenderSlide,
  el: TextElement,
  text: string,
  blockedBelow = slide.height,
): string | null {
  const display = el.translationDisplay;
  if (!display) return 'Reserve an area below the source words.';
  const { area, fontSize } = display;
  if (
    el.rotation ||
    el.motion ||
    slide.deck ||
    area.x < 0 ||
    area.y < el.frame.y + el.frame.height ||
    area.x + area.width > slide.width ||
    area.y + area.height > Math.min(slide.height, blockedBelow)
  )
    return 'Keep the translation below its source and inside the clear slide area.';
  if (fontSize < (36 * slide.height) / 1080 || !translationFits(text, area, fontSize))
    return 'Edit or split the translation so it fits at a readable size.';
  if (slide.elements.some((other) => other.id !== el.id && !other.hidden && overlaps(area, other.frame)))
    return 'The translation area overlaps another object.';
  return null;
}

/** Original content is never moved; unreviewed, mismatched or unsafe words add nothing. */
export function checkedTranslationView(slide: RenderSlide, destination: TranslationDestination): RenderSlide {
  const additions: TextElement[] = [];
  for (const el of slide.elements) {
    if (el.kind !== 'text' || el.hidden) continue;
    const choice = translationChoiceFor(el.translationDisplay, destination.groupId, destination.outputId);
    const value = el.translations?.find((item) => item.targetLanguage === choice);
    if (!value || !translationSourceSupported(el, value.sourceLanguage)) continue;
    const text = checkedText(value, translationSource(el));
    if (
      !text ||
      translationLayoutProblem(slide, el, text, destination.blockedBelow) ||
      !el.translationDisplay
    )
      continue;
    additions.push({
      id: `${el.id}:translation:${choice}`,
      kind: 'text',
      text,
      lang: value.targetLanguage,
      frame: el.translationDisplay.area,
      style: {
        ...el.style,
        fontFamily: null,
        fontSize: el.translationDisplay.fontSize,
        lineHeight: 1.45,
        shrinkToFit: false,
        noWrap: false,
        verticalAlign: 'top',
      },
      everyScreen: true,
    });
  }
  // Translation areas must not overlap each other either.
  const clear = additions.filter(
    (el) => !additions.some((other) => other !== el && overlaps(el.frame, other.frame)),
  );
  return clear.length ? { ...slide, elements: [...slide.elements, ...clear] } : slide;
}

/** Public playback carries checked pairs only, and never the local reader's name. */
export function playbackTranslationSlide(slide: RenderSlide): RenderSlide {
  let changed = false;
  const elements = slide.elements.map((el) => {
    if (el.kind !== 'text' || !el.translations?.length) return el;
    changed = true;
    const translations = el.translations
      .filter(
        (value) =>
          translationSourceSupported(el, value.sourceLanguage) && checkedText(value, translationSource(el)),
      )
      .map((value) => ({ ...value, reader: 'Checked' }));
    return { ...el, translations };
  });
  return changed ? { ...slide, elements } : slide;
}
