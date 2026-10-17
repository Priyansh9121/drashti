import { contrastRatio } from './contrast';
import { LANGS } from './model';
import { FLOOR_WARN_PX } from './readable';
import { TITLE_SAFE } from './safe-areas';
import { LANG_NAMES, type ThemeFields, type ThemeLangStyle } from './themes';

/*
 * The theme contract (Sessions 31–36, SLD-4; docs/design.md): what a theme must give the hall, so its words
 * read from the back. Drashti's default and built-in themes keep it (a unit test), and saving a theme that
 * misses it warns, saying what and why, but never refuses: a mandir may know its own hall.
 *
 *   - every language's words, and a passage's reference line, at least 36 px on a 1080-line slide;
 *   - their colour at least 4.5:1 against the theme's background (black where it leaves the slide's own
 *     or puts a picture there, as its preview shows it); Drashti's own aim 7:1;
 *   - no thinner than weight 400;
 *   - lines at least 1.15 apart, so Gujarati and Hindi marks never touch the line above;
 *   - the words' box inside title-safe (90% of the slide, centred).
 */

/** Smallest a theme's words may be, in slide pixels at 1080 lines (the slide editor's warning floor). */
export const THEME_MIN_SIZE = FLOOR_WARN_PX;
/** Least contrast against the background. */
export const THEME_MIN_CONTRAST = 4.5;
/** Thinnest weight. */
export const THEME_MIN_WEIGHT = 400;
/** Least line height. */
export const THEME_MIN_LINE_HEIGHT = 1.15;

/** The colour a theme's words are measured on: its own background's, else black. */
const backgroundOf = (fields: ThemeFields) =>
  fields.background.kind === 'color' ? fields.background.color : '#000000';

/** What a theme misses of the contract, one plain sentence each; empty when it keeps it all. */
export function themeContract(fields: ThemeFields): string[] {
  const out: string[] = [];
  const bg = backgroundOf(fields);
  const words = (name: string, style: ThemeLangStyle) => {
    if (style.size < THEME_MIN_SIZE)
      out.push(
        `${name} is set at ${String(style.size)} px: below ${String(THEME_MIN_SIZE)} px the back of the hall cannot read it.`,
      );
    const ratio = contrastRatio(style.color, bg);
    if (ratio < THEME_MIN_CONTRAST)
      out.push(
        `${name}’s colour is ${ratio.toFixed(1)}:1 against the background: below ${String(THEME_MIN_CONTRAST)}:1 it fades on a projector.`,
      );
    if (style.weight < THEME_MIN_WEIGHT)
      out.push(
        `${name} is set at weight ${String(style.weight)}: thinner than ${String(THEME_MIN_WEIGHT)} is hard to read from far.`,
      );
  };
  for (const lang of LANGS) words(LANG_NAMES[lang], fields.langs[lang]);
  words('The reference line', fields.reference);
  if (fields.box.lineHeight < THEME_MIN_LINE_HEIGHT - 0.0001)
    out.push(
      `Lines are ${String(fields.box.lineHeight)} apart: below ${String(THEME_MIN_LINE_HEIGHT)} Gujarati and Hindi marks touch the line above.`,
    );
  const margin = (1 - TITLE_SAFE) / 2;
  const { x, y, width, height } = fields.box;
  if (
    x < margin - 0.0005 ||
    y < margin - 0.0005 ||
    x + width > 1 - margin + 0.0005 ||
    y + height > 1 - margin + 0.0005
  )
    out.push('The words’ box reaches outside title-safe (90% of the slide): some screens cut its edges.');
  return out;
}
