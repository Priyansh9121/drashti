import { createContext, useContext } from 'react';
import type { Lang, TranslitSource } from '../../../shared/model';
import { detectLang } from '../../../shared/text-runs';
import { HTML_LANG } from './fonts';

/*
 * The `lang` of words (Sessions 31–36, I18N-4): a phone's reader, its fonts and a browser's translator follow
 * it. Transliteration says what it transliterates: gu-Latn, hi-Latn or sa-Latn, from the slide's own
 * Gujarati, Hindi or Sanskrit (shared/tracks.ts translitSource), gu-Latn when nothing says.
 */

/** What the transliteration being drawn is of: given by a slide (SlideView) to its boxes. */
export const TranslitSourceContext = createContext<TranslitSource | null>(null);

/** The `lang` for words in a language; transliteration's from its source. */
export function htmlLang(lang: Lang, source: TranslitSource | null = null): string {
  return lang === 'translit' ? `${source ?? 'gu'}-Latn` : HTML_LANG[lang];
}

/** The same, for the transliteration of the slide being drawn. */
export function useHtmlLang(): (lang: Lang | null | undefined) => string | undefined {
  const source = useContext(TranslitSourceContext);
  return (lang) => (lang ? htmlLang(lang, source) : undefined);
}

/** The `lang` for words no one marked (a message, a note, a title): by their letters; none without letters. */
export function textLang(text: string, source: TranslitSource | null = null): string | undefined {
  const lang = detectLang(text);
  return lang ? htmlLang(lang, source) : undefined;
}
