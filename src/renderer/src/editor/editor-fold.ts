import { useEffect, useState } from 'react';

/*
 * The slide editor in a small window (a22-ribbonfold; QA23-X95N-1c): at its least window with the system's text at
 * 200% (442 x 260 CSS pixels) the top and the ribbon took 241-279 of its 260 px, and the slide list (176) and the
 * Inspector (288) more than its 442, so the slide was 96 x 54 (24 x 16 for a PDF) and below the window. In a window
 * this short the ribbon folds to its group tabs, a tab dropping its ribbon over the slide; in one this narrow the
 * Inspector folds behind a button, opening over the slide. Each can be kept open. Neither folds at 100% text in any
 * window the editor allows (its least is 884 x 521 inside on Windows, 900 wide on the Mac), nor at 1024 x 645, where
 * the guides' pictures are taken.
 */

/** A window this short (CSS pixels) folds the ribbon: 200% text at the least window is 260, 150% 347. */
export const SHORT = '(max-height: 400px)';
/** A window this narrow folds the Inspector: 200% text at the least window is 442, 150% 589. */
export const NARROW = '(max-width: 640px)';

/** What the window's size folds. */
export interface EditorFold {
  ribbon: boolean;
  inspector: boolean;
}

/** What folds, for the window's media queries as they answer now. */
export function foldFor(matches: (query: string) => boolean): EditorFold {
  return { ribbon: matches(SHORT), inspector: matches(NARROW) };
}

/** What folds now, again as the window or its text size changes. */
export function useEditorFold(): EditorFold {
  const read = (): EditorFold =>
    typeof matchMedia === 'function'
      ? foldFor((query) => matchMedia(query).matches)
      : { ribbon: false, inspector: false };
  const [fold, setFold] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const queries = [SHORT, NARROW].map((q) => matchMedia(q));
    const on = () => {
      setFold(read());
    };
    for (const q of queries) q.addEventListener('change', on);
    return () => {
      for (const q of queries) q.removeEventListener('change', on);
    };
  }, []);
  return fold;
}

/** The room kept round the slide in its area, each side. */
export const SLIDE_PAD = 32;
/** In an area this small (a folded editor's, or a narrow one's), only this much, so the slide keeps the room there is. */
export const SMALL_PAD = 8;

/**
 * The room round the slide in an area `width` x `height` CSS pixels big: 32 px, or 8 in an area narrower than 400
 * or shorter than 160 (never at 100% text: at the least window the slide's area is at least 420 wide and 196 high,
 * the slide list across the bottom included).
 */
export const slidePad = (width: number, height: number): number =>
  width < 400 || height < 160 ? SMALL_PAD : SLIDE_PAD;
