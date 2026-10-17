import type { SlideElement, TextElement } from './model';
import { wrappedLines } from './shastra-slides';

/*
 * Words the hall can read (Sessions 31–36, SLD-1). The slide editor warns when a box's words are drawn
 * below 36 px at a 1080-line reference, and notes it below 48 px; the screens never refuse a slide, and
 * their shrink-to-fit floor (MIN_FIT, a tenth of the size set) is unchanged. Every text box is measured
 * where it is drawn (render/SlideView.tsx marks one whose words run past it with data-overset); the
 * import report, which has no window to measure in, counts by an estimate (shastra-slides' word widths).
 */

export { NEW_TEXT_LINE_HEIGHT } from './model';

/** Below this line height the slide editor warns of a box with Gujarati or Hindi in it (Sessions 31–36, I18N-2). */
export const INDIC_LINE_HEIGHT_MIN = 1.3;

/** The smallest shrink-to-fit goes: a tenth of the size set. */
export const MIN_FIT = 0.1;
/** The reference the floors are said at: a slide 1080 lines high. */
export const REFERENCE_LINES = 1080;
/** Below this many pixels drawn (at 1080 lines) the editor warns. */
export const FLOOR_WARN_PX = 36;
/** Below this many it notes it. */
export const FLOOR_NOTE_PX = 48;

const runsOf = (el: TextElement) => (el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text }]);

/** The sizes a box's words are set at (its runs', or its own), in slide pixels: words only, not spaces. */
function sizesOf(el: TextElement): number[] {
  return runsOf(el)
    .filter((r) => r.text.trim() !== '')
    .map((r) => ('size' in r && typeof r.size === 'number' ? r.size : el.style.fontSize));
}

/** The smallest size the box's words are set at, in slide pixels (its own size when it has no words). */
export function smallestSize(el: TextElement): number {
  const sizes = sizesOf(el);
  return sizes.length > 0 ? Math.min(...sizes) : el.style.fontSize;
}

/** The size its smallest words are drawn at, at the 1080 reference: set size × fit × 1080 / slide height. */
export function drawnPx(el: TextElement, slideHeight: number, fit = 1): number {
  return (smallestSize(el) * fit * REFERENCE_LINES) / slideHeight;
}

/** How a drawn size reads from the back of the hall: below 36 px a warning, below 48 a note. */
export function floorOf(px: number): 'warning' | 'note' | null {
  if (px < FLOOR_WARN_PX - 0.05) return 'warning';
  if (px < FLOOR_NOTE_PX - 0.05) return 'note';
  return null;
}

/** The height a box's words take at this fit, by the estimate (the largest size set, so it errs full). */
function neededHeight(el: TextElement, fit: number): number {
  const size = Math.max(el.style.fontSize, ...sizesOf(el)) * fit;
  const text = runsOf(el)
    .map((r) => r.text)
    .join('');
  const lines = text
    .split('\n')
    .reduce((n, paragraph) => n + wrappedLines(paragraph, size, el.frame.width, el.style.fontWeight), 0);
  return lines * size * el.style.lineHeight;
}

/**
 * By the estimate: the fit a box's words are drawn at (1 unless shrink-to-fit makes them smaller, never
 * below MIN_FIT), and whether they still run past it.
 */
export function estimateFit(el: TextElement): { fit: number; over: boolean } {
  const fits = (fit: number) => neededHeight(el, fit) <= el.frame.height + 0.5;
  if (fits(1)) return { fit: 1, over: false };
  if (el.style.shrinkToFit !== true) return { fit: 1, over: true };
  if (!fits(MIN_FIT)) return { fit: MIN_FIT, over: true };
  let lo = MIN_FIT;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { fit: lo, over: false };
}

/**
 * A presentation's slides counted by the estimate, for the import report: how many have words running past
 * a box, and how many have words drawn below 36 px at 1080 lines.
 */
export function readabilityCounts(
  slides: readonly { elements: readonly SlideElement[] }[],
  slideHeight: number,
): { over: number; small: number } {
  let over = 0;
  let small = 0;
  for (const slide of slides) {
    const texts = slide.elements.filter(
      (e): e is TextElement =>
        e.kind === 'text' && e.text.trim() !== '' && !(e.runs ?? []).some((r) => r.legacy),
    );
    const fits = texts.map((e) => ({ e, ...estimateFit(e) }));
    if (fits.some((f) => f.over)) over++;
    if (fits.some((f) => floorOf(drawnPx(f.e, slideHeight, f.fit)) === 'warning')) small++;
  }
  return { over, small };
}
