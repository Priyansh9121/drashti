import { placeContent, type Size } from './scaling';
import type { ScalingMode } from './screens';
import type { Rect, RenderSlide, TextElement } from './model';
import type { TranslationLanguage } from './prepared-translations';
import { checkedText, translationForSource } from './prepared-translations';

export type TranslationChoice = 'off' | TranslationLanguage;
export interface TranslationDisplay {
  sourceLanguage?: TranslationLanguage;
  choice: TranslationChoice;
  groups: Record<string, TranslationChoice>;
  outputs: Record<string, TranslationChoice>;
  /** Deliberately reserved below the source box, in slide pixels. */
  area: Rect;
  fontSize: number;
}
export interface TranslationDestination {
  hidden?: boolean;
  canvas?: Size;
  scaling?: ScalingMode;
  blockedAbove?: number;
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
  let lines = 0;
  for (const explicit of text.split('\n')) {
    let used = 0;
    lines += 1;
    for (const word of explicit.split(/\s+/u)) {
      const width = [...graphemes.segment(word)].length;
      if (width > columns) return false;
      if (used && used + 1 + width > columns) {
        lines += 1;
        used = width;
      } else used += (used ? 1 : 0) + width;
    }
  }
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
  const origin = slide.pageCrop ?? { x: 0, y: 0 };
  if (
    el.rotation ||
    el.motion ||
    slide.deck ||
    area.x < origin.x ||
    area.y < origin.y ||
    area.y < el.frame.y + el.frame.height ||
    area.x - origin.x + area.width > slide.width ||
    area.y - origin.y + area.height > Math.min(slide.height, blockedBelow)
  )
    return 'Keep the translation below its source and inside the clear slide area.';
  if (fontSize < (36 * slide.height) / 1080 || !translationFits(text, area, fontSize))
    return 'Edit or split the translation so it fits at a readable size.';
  if (slide.elements.some((other) => other.id !== el.id && !other.hidden && overlaps(area, other.frame)))
    return 'The translation area overlaps another object.';
  return null;
}

/** Check the actual output canvas too: fill cropping and narrow fits must not cut or miniaturize words. */
export function translationDestinationProblem(
  slide: RenderSlide,
  el: TextElement,
  text: string,
  destination: TranslationDestination,
): string | null {
  const base = translationLayoutProblem(slide, el, text, destination.blockedBelow);
  if (base) return base;
  const display = el.translationDisplay;
  if (!display) return 'Reserve an area below the source words.';
  const origin = slide.pageCrop ?? { x: 0, y: 0 };
  if (display.area.y - origin.y < (destination.blockedAbove ?? 0))
    return 'Keep the translation clear of the caption band.';
  if (!destination.canvas) return null;
  const at = placeContent(slide, destination.canvas, destination.scaling ?? 'fit');
  const left = at.x + (display.area.x - origin.x) * at.scaleX;
  const top = at.y + (display.area.y - origin.y) * at.scaleY;
  if (
    left < 0 ||
    top < 0 ||
    left + display.area.width * at.scaleX > destination.canvas.width ||
    top + display.area.height * at.scaleY > destination.canvas.height
  )
    return 'The translation is cropped on this screen. Reserve an area inside its visible picture.';
  if (display.fontSize * Math.min(at.scaleX, at.scaleY) * 1080 < 36 * destination.canvas.height)
    return 'The translation is too small on this screen. Use a wider picture or reserve a larger type size.';
  return null;
}

function sourceLanguageOf(el: TextElement): TranslationLanguage | undefined {
  const language = el.translationDisplay?.sourceLanguage ?? el.translations?.[0]?.sourceLanguage ?? el.lang;
  return language === 'gu' || language === 'hi' || language === 'en' ? language : undefined;
}

/** Original content is never moved; unreviewed, mismatched or unsafe words add nothing. */
export function checkedTranslationView(slide: RenderSlide, destination: TranslationDestination): RenderSlide {
  const additions: TextElement[] = [];
  const paired = new Set<string>();
  for (const el of slide.elements) {
    if (el.kind !== 'text' || el.hidden || el.opacity === 0) continue;
    const display = el.translationDisplay;
    const sourceLanguage = sourceLanguageOf(el);
    const enabled =
      display &&
      [display.choice, ...Object.values(display.groups), ...Object.values(display.outputs)].some(
        (choice) => choice !== 'off',
      );
    if (enabled && sourceLanguage && translationSourceSupported(el, sourceLanguage)) paired.add(el.id);
    if (destination.hidden) continue;
    const choice = translationChoiceFor(el.translationDisplay, destination.groupId, destination.outputId);
    const value = el.translations?.find((item) => item.targetLanguage === choice);
    if (!value || !translationSourceSupported(el, value.sourceLanguage)) continue;
    const text = checkedText(value, translationSource(el));
    if (!text || translationDestinationProblem(slide, el, text, destination) || !el.translationDisplay)
      continue;
    paired.add(el.id);
    additions.push({
      id: `${el.id}:translation:${choice}`,
      kind: 'text',
      text,
      preparedTranslation: true,
      lang: value.targetLanguage,
      frame: el.translationDisplay.area,
      style: {
        fontFamily: null,
        fontSize: el.translationDisplay.fontSize,
        fontWeight: 400,
        color: el.style.color,
        align: el.style.align,
        lineHeight: 1.45,
        shrinkToFit: false,
        shadow: false,
        verticalAlign: 'top',
      },
      everyScreen: true,
    });
  }
  // Translation areas must not overlap each other either.
  const clear = additions.filter(
    (el) => !additions.some((other) => other !== el && overlaps(el.frame, other.frame)),
  );
  return clear.length || (slide.kirtan && paired.size > 0)
    ? {
        ...slide,
        translationAnchors: [...paired, ...clear.map((el) => el.id)],
        elements: [
          ...slide.elements.map((el) =>
            slide.kirtan && el.kind === 'text' && paired.has(el.id) ? { ...el, everyScreen: true } : el,
          ),
          ...clear,
        ],
      }
    : slide;
}

const playbackCache = new WeakMap<RenderSlide, RenderSlide>();

/** Public playback carries checked pairs only, and never the local reader's name. */
export function playbackTranslationSlide(slide: RenderSlide): RenderSlide {
  const cached = playbackCache.get(slide);
  if (cached) return cached;
  const elements = slide.elements.map((el) => {
    if (el.kind !== 'text' || !el.translations?.length) return el;
    const translations = el.translations
      .filter(
        (value) =>
          translationSourceSupported(el, value.sourceLanguage) && checkedText(value, translationSource(el)),
      )
      .map((value) => ({ ...value, reader: 'Checked' }));
    const sourceLanguage = sourceLanguageOf(el);
    const translationDisplay =
      el.translationDisplay && sourceLanguage
        ? { ...el.translationDisplay, sourceLanguage }
        : el.translationDisplay;
    return { ...el, translations, translationDisplay };
  });
  const result = elements.some((el, index) => el !== slide.elements[index]) ? { ...slide, elements } : slide;
  playbackCache.set(slide, result);
  return result;
}

export function refreshTranslationReview(el: TextElement): TextElement {
  if (!el.translations?.length) return el;
  const translations = el.translations.map((value) => {
    const current = translationForSource(value, translationSource(el));
    return translationSourceSupported(el, value.sourceLanguage)
      ? current
      : { ...current, state: 'needs-recheck' as const, reader: null, reviewFingerprint: null };
  });
  return translations.every((value, index) => value === el.translations?.[index])
    ? el
    : { ...el, translations };
}
