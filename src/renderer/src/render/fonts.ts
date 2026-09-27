import type { Lang } from '../../../shared/model';

export const BUNDLED_FAMILIES = ['Noto Sans', 'Noto Sans Gujarati', 'Noto Sans Devanagari'] as const;
export const BUNDLED_WEIGHTS = [400, 500, 700] as const;

const LATIN = "'Noto Sans'";
const GUJARATI = "'Noto Sans Gujarati'";
const DEVANAGARI = "'Noto Sans Devanagari'";

/** Font stacks per language: the bundled Noto font first, then the others as fallbacks. */
export const LANG_FONT_STACK: Record<Lang | 'default', string> = {
  en: `${LATIN}, ${GUJARATI}, ${DEVANAGARI}, sans-serif`,
  translit: `${LATIN}, sans-serif`,
  gu: `${GUJARATI}, ${LATIN}, sans-serif`,
  hi: `${DEVANAGARI}, ${LATIN}, sans-serif`,
  default: `${LATIN}, ${GUJARATI}, ${DEVANAGARI}, sans-serif`,
};

/** The CSS lang attribute for a language track. */
export const HTML_LANG: Record<Lang, string> = { en: 'en', gu: 'gu', hi: 'hi', translit: 'gu-Latn' };

/** CSS font-family for a text element: its own font (if any) backed by the bundled stack. */
export function fontFamilyFor(family: string | null, lang: Lang | null): string {
  const stack = LANG_FONT_STACK[lang ?? 'default'];
  if (!family) return stack;
  const quoted = /^["'].*["']$/.test(family) ? family : `"${family.replace(/"/g, '')}"`;
  return `${quoted}, ${stack}`;
}

/** Samples that pull in every unicode-range subset we render (Latin with diacritics, Gujarati, Devanagari). */
const SAMPLES: Record<(typeof BUNDLED_FAMILIES)[number], string> = {
  'Noto Sans': 'Aa āīūṣṇḍṁṭṅ',
  'Noto Sans Gujarati': 'ક્ષ સ્વ',
  'Noto Sans Devanagari': 'क्ष स्व',
};

let loading: Promise<void> | null = null;

/**
 * Load every bundled font before anything is shown, so an output never
 * flashes a fallback font when the first slide goes live.
 */
export function preloadFonts(): Promise<void> {
  loading ??= Promise.all(
    BUNDLED_FAMILIES.flatMap((family) =>
      BUNDLED_WEIGHTS.map((weight) => document.fonts.load(`${weight} 48px "${family}"`, SAMPLES[family])),
    ),
  ).then(() => undefined);
  return loading;
}
