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

/**
 * The same queries as classes, for what folds in the layout itself: the moment the window or its text size changes,
 * before the fold above is told (a media query's change comes with the next frame, and React's render after it), the
 * ribbon, the Inspector and a PDF's notes are already out of the way, so the page never scrolls down for a moment (the
 * Mac's CI, run 45571462882: the page read 14 ms after 200% text landed scrolled, the ribbon still in its place).
 * Each matches its query above (editor-fold.test.ts).
 */
export const HIDE_WHEN_SHORT = '[@media(max-height:400px)]:hidden';
export const HIDE_WHEN_NARROW = '[@media(max-width:640px)]:hidden';

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
  const [fold, setFold] = useState(foldNow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    // The same fold kept as it is (no render, no "fold ended" for a value that did not change).
    return watchFold(matchMedia, (next) => {
      setFold((was) => (was.ribbon === next.ribbon && was.inspector === next.inspector ? was : next));
    });
  }, []);
  return fold;
}

/** A media query list as the fold watches it. */
interface MediaList {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** Tells `told` what folds now, and again whenever the window's queries change; returns how to stop. */
export function watchFold(media: (query: string) => MediaList, told: (fold: EditorFold) => void): () => void {
  const lists = [SHORT, NARROW].map((q) => media(q));
  const on = () => {
    told(foldFor((query) => media(query).matches));
  };
  for (const list of lists) list.addEventListener('change', on);
  // And once now: a change between the first render's reading and this listening came and went unheard (round 4).
  on();
  return () => {
    for (const list of lists) list.removeEventListener('change', on);
  };
}

/**
 * Whether a group's tab drops the ribbon over the slide: the ribbon not kept open, and the window short, as the fold
 * has been told (`folded`) or as the window is now (`now`). The layout hides the ribbon by CSS the moment the window is
 * short, and the fold hears of it with the next frame (later on a slow computer): a tab pressed between the two drops
 * the ribbon all the same, shown as soon as the fold is told (the Mac's CI on 2314c749f: Enter on the chosen tab
 * dropped nothing, and the ribbon never came).
 */
export function tabDropsRibbon(kept: boolean, folded: boolean, now: EditorFold): boolean {
  return !kept && (folded || now.ribbon);
}

/** The room kept round the slide in its area, each side. */
export const SLIDE_PAD = 32;
/** In a folded editor (a short or a narrow window), only this much, so the slide keeps the room there is. */
export const SMALL_PAD = 8;

/**
 * The room round the slide: 8 px where the window folds the ribbon or the Inspector, else 32. Decided by the window's
 * media queries, as the folds are, never by the slide's area: a scrollbar coming and going with the room would
 * change the area and the room again, round and round (a22-review-ribbonfold S1), and at 100% text it is always 32.
 */
export const slidePad = (fold: EditorFold): number => (fold.ribbon || fold.inspector ? SMALL_PAD : SLIDE_PAD);

/** What folds now, read once (a wheel's zoom, outside React). */
export const foldNow = (): EditorFold =>
  typeof matchMedia === 'function'
    ? foldFor((query) => matchMedia(query).matches)
    : { ribbon: false, inspector: false };
