import type { TextElement } from '../../../shared/model';
import { BUNDLED_FAMILIES } from './fonts';

/*
 * Whether this computer has a font a slide names (Sessions 31–36, I18N-1): a legacy Gujarati font, or one a
 * theme or an imported file names. `document.fonts.check()` answers yes for any font it is not loading,
 * there or not (tests/e2e/fonts-missing.spec.ts shows it), so the words are measured instead: drawn in the
 * font with each of two fallbacks behind it, a font this computer lacks measures exactly as each fallback.
 * Answers are kept for the session: fonts are not installed while Drashti runs.
 */

/** Letters of each script, wide and narrow, so a font that has any of them measures apart. */
const SAMPLE = 'mmmmmmmmmmlliiWWW 0123456789 ગુજરાતી પંક્તિ हिन्दी पंक्ति';

const GENERIC = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  'inherit',
  'initial',
]);

const BUNDLED = new Set<string>(BUNDLED_FAMILIES.map((f) => f.toLowerCase()));

const known = new Map<string, boolean>();
let probe: HTMLSpanElement | null = null;

/** The width of the sample in this font list, measured off the page (never seen, never in a picture). */
function widthIn(family: string): number {
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.dataset['fontProbe'] = '';
    probe.textContent = SAMPLE;
    Object.assign(probe.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      visibility: 'hidden',
      whiteSpace: 'pre',
      fontSize: '72px',
      lineHeight: 'normal',
      pointerEvents: 'none',
    });
    document.body.append(probe);
  }
  probe.style.fontFamily = family;
  return probe.getBoundingClientRect().width;
}

/** The families a CSS font list names, as written, without the generic ones and Drashti's own. */
export function namedFamilies(list: string | null | undefined): string[] {
  if (!list) return [];
  return list
    .split(',')
    .map((f) =>
      f
        .trim()
        .replace(/^["']|["']$/gu, '')
        .trim(),
    )
    .filter((f) => f !== '' && !GENERIC.has(f.toLowerCase()) && !BUNDLED.has(f.toLowerCase()));
}

/** Whether this computer can draw in this font family. */
export function hasFont(family: string): boolean {
  const key = family.toLowerCase();
  if (BUNDLED.has(key) || GENERIC.has(key)) return true;
  const kept = known.get(key);
  if (kept !== undefined) return kept;
  const quoted = `"${family.replace(/["\\]/gu, '')}"`;
  const has =
    widthIn(`${quoted}, monospace`) !== widthIn('monospace') ||
    widthIn(`${quoted}, serif`) !== widthIn('serif');
  known.set(key, has);
  return has;
}

/** The fonts a box of words names (its own and its runs') that this computer does not have. */
export function missingFontsOf(el: TextElement): string[] {
  const names = new Set([
    ...namedFamilies(el.style.fontFamily),
    ...(el.runs ?? []).flatMap((r) => namedFamilies(r.font)),
  ]);
  return [...names].filter((f) => !hasFont(f));
}
