import type { Lang } from './model';
import { detectLang, scriptOf } from './text-runs';

/** PDF subsets are not installed fonts. Editable words use the same bundled fonts on every output and in print. */
export function pdfWordFont(words: string): { family: string; lang: Lang } {
  const script = scriptOf(words);
  return {
    family: script === 'gu' ? 'Noto Sans Gujarati' : script === 'hi' ? 'Noto Sans Devanagari' : 'Noto Sans',
    lang: detectLang(words) ?? 'en',
  };
}

export const PDF_WORD_FONT_NOTE =
  'Editable PDF words use bundled Noto Sans, Noto Sans Gujarati and Noto Sans Devanagari instead of the PDF’s font subsets. New letters use these fonts on the screens and in Save a PDF copy. Line breaks and spacing may differ from the source.';
