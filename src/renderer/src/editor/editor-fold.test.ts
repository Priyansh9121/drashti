import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tabs } from '../ui/Tabs';
import {
  foldFor,
  HIDE_WHEN_NARROW,
  HIDE_WHEN_SHORT,
  NARROW,
  SHORT,
  SLIDE_PAD,
  SMALL_PAD,
  slidePad,
  tabDropsRibbon,
  watchFold,
} from './editor-fold';

/*
 * The slide editor in a small window (a22-ribbonfold): what folds at a window's size in CSS pixels, and the room kept
 * round the slide. The sizes are the editor's least window inside (884 x 521 on Windows, 900 wide on the Mac), CI's
 * 1024 x 645 and the owner's 1410 wide, at 100% text and larger (CSS pixels shrink as the text grows).
 */

/** The window's media queries answered for a window `width` x `height` CSS pixels big. */
const sized = (width: number, height: number) => (query: string) => {
  if (query === SHORT) return height <= 400;
  if (query === NARROW) return width <= 640;
  throw new Error(`no answer for ${query}`);
};

describe('what a small window folds (a22-ribbonfold)', () => {
  it('nothing at 100% text in any window the editor allows, nor at 125% at its least', () => {
    for (const [w, h] of [
      [884, 521],
      [900, 521],
      [1024, 645],
      [1410, 900],
      [884 / 1.25, 521 / 1.25],
    ] as const)
      expect(foldFor(sized(w, h)), `${String(w)} x ${String(h)}`).toEqual({
        ribbon: false,
        inspector: false,
      });
  });

  it('the ribbon and the Inspector at the least window with 150% or 200% text', () => {
    for (const zoom of [1.5, 2])
      expect(foldFor(sized(884 / zoom, 521 / zoom)), `${String(zoom * 100)}%`).toEqual({
        ribbon: true,
        inspector: true,
      });
  });

  it('only what is short or narrow: CI’s 1024 x 645 at 200% folds both, a wide short window the ribbon', () => {
    expect(foldFor(sized(512, 322.5))).toEqual({ ribbon: true, inspector: true });
    expect(foldFor(sized(1400, 380))).toEqual({ ribbon: true, inspector: false });
    expect(foldFor(sized(600, 800))).toEqual({ ribbon: false, inspector: true });
  });
});

describe('what folds in the layout itself, at once (the Mac’s CI, run 45571462882)', () => {
  it('is hidden by the same media queries as the fold, so the two never disagree once the fold is told', () => {
    expect(HIDE_WHEN_SHORT).toBe(`[@media${SHORT.replace(/\s/gu, '')}]:hidden`);
    expect(HIDE_WHEN_NARROW).toBe(`[@media${NARROW.replace(/\s/gu, '')}]:hidden`);
  });
});

/** A window whose size can change, and whose media query lists say so when told to (as the next frame does). */
function aWindow(width: number, height: number) {
  let size = { width, height };
  const listeners = new Set<() => void>();
  return {
    media: (query: string) => ({
      get matches() {
        return sized(size.width, size.height)(query);
      },
      addEventListener: (_type: 'change', listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'change', listener: () => void) => {
        listeners.delete(listener);
      },
    }),
    resize: (w: number, h: number) => {
      size = { width: w, height: h };
    },
    tell: () => {
      for (const listener of listeners) listener();
    },
    listening: () => listeners.size,
  };
}

describe('the fold follows the window’s queries (a22-review-ribbonfold round 4)', () => {
  it('is told at once of a change between the first render and its listening, so CSS never hides what no button reaches', () => {
    const win = aWindow(884, 521);
    // The first render reads the queries: nothing folds.
    expect(foldFor((q) => win.media(q).matches)).toEqual({ ribbon: false, inspector: false });
    // 200% text lands before the fold listens; its change event came and went.
    win.resize(442, 260);
    const told: { ribbon: boolean; inspector: boolean }[] = [];
    const stop = watchFold(win.media, (fold) => told.push(fold));
    expect(told.at(-1)).toEqual({ ribbon: true, inspector: true });
    stop();
  });

  it('is told of each later change, and of none once it stops listening', () => {
    const win = aWindow(442, 260);
    const told: { ribbon: boolean; inspector: boolean }[] = [];
    const stop = watchFold(win.media, (fold) => told.push(fold));
    win.resize(884, 521);
    win.tell();
    expect(told.at(-1)).toEqual({ ribbon: false, inspector: false });
    stop();
    expect(win.listening()).toBe(0);
    const before = told.length;
    win.resize(442, 260);
    win.tell();
    expect(told).toHaveLength(before);
  });
});

describe('a group’s tab drops the ribbon over the slide (the Mac’s CI, run of 25 Nov 23:10, 2314c749f)', () => {
  const short = { ribbon: true, inspector: true };
  const tall = { ribbon: false, inspector: false };

  it('where the window is short now, even before the fold has been told: the layout already hides the ribbon', () => {
    // CSS folds at once; the fold hears of it with the next frame, later on a slow computer. A tab pressed between
    // the two must still drop the ribbon, or it does nothing (the ribbon hidden, no drop) and is never dropped.
    expect(tabDropsRibbon(false, false, short)).toBe(true);
    expect(tabDropsRibbon(false, true, short)).toBe(true);
  });

  it('never where the ribbon is kept open, nor in a window that is not short', () => {
    expect(tabDropsRibbon(true, false, short)).toBe(false);
    expect(tabDropsRibbon(true, false, tall)).toBe(false);
    expect(tabDropsRibbon(false, false, tall)).toBe(false);
  });
});

describe('the room round the slide', () => {
  // Decided by what the window folds, never by the slide's area (a22-review-ribbonfold S1: a scrollbar coming and
  // going with the room changed the area and the room again, round and round; and at 100% text an area made small by
  // the slide list across the bottom and a PDF's notes got 8 px).
  it('is 32 px wherever the window folds nothing: every window the editor allows at 100% text', () => {
    for (const [w, h] of [
      [884, 521],
      [1024, 645],
      [1410, 900],
    ] as const)
      expect(slidePad(foldFor(sized(w, h))), `${String(w)} x ${String(h)}`).toBe(SLIDE_PAD);
  });

  it('is 8 px where the window folds the ribbon or the Inspector, so the slide keeps the room there is', () => {
    expect(slidePad({ ribbon: true, inspector: true })).toBe(SMALL_PAD);
    expect(slidePad({ ribbon: true, inspector: false })).toBe(SMALL_PAD);
    expect(slidePad({ ribbon: false, inspector: true })).toBe(SMALL_PAD);
    expect(slidePad(foldFor(sized(442, 260)))).toBe(SMALL_PAD);
    // 175% text at CI's 1024 wide (about 585 x 368): both fold, whatever a scrollbar does to the slide's area.
    expect(slidePad(foldFor(sized(1024 / 1.75, 645 / 1.75)))).toBe(SMALL_PAD);
  });
});

describe('a folding tab says whether its panel shows', () => {
  const items = [
    { id: 'words', label: 'Words' },
    { id: 'insert', label: 'Insert' },
  ] as const;
  const tabs = (expanded?: boolean) =>
    renderToStaticMarkup(
      createElement(Tabs<'words' | 'insert'>, {
        group: 'placeholder',
        label: 'Placeholder groups',
        items,
        value: 'words',
        onChange: () => undefined,
        ...(expanded === undefined ? {} : { expanded }),
      }),
    );

  it('on the chosen tab alone, and not at all where the panels never fold', () => {
    expect(tabs(false).match(/aria-expanded="[a-z]+"/gu)).toEqual(['aria-expanded="false"']);
    expect(tabs(true).match(/aria-expanded="[a-z]+"/gu)).toEqual(['aria-expanded="true"']);
    expect(tabs()).not.toContain('aria-expanded');
  });
});
