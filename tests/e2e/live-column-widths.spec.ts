import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { sizeOperatorWindow } from './window-size';

/*
 * The live column at every width it can have (alpha.22, the owner's report on alpha.21, 24 Nov 2026: "UI Front end
 * issue.", in a live column a little wider than its least, Next's word touched its left edge and its key ran past its
 * right). Its splitter dragged from the column's least to its most, a pixel at a time, in Pro and Simple Mode: at each
 * width every button under LIVE and in Audio holds its contents inside its own padding (its words, icons and key
 * whole), Back, Next and the next picture lie side by side, none over another, Back and Next are the same width, and
 * their keys show on both or on neither. At the column's first width and at its most, the keys show. Only the row's
 * widths are measured, never the column's height. Placeholder content only.
 */

/** Wide enough for the live column's most (Layout.tsx: 620, with the middle's 400 and the playlists' 220 beside it). */
const WINDOW = { width: 1280, height: 800 } as const;

/** The live column at its least and at its most (Layout.tsx's RIGHT), in a window as wide as WINDOW. */
const LEAST = 300;
const MOST = 620;

/** The live column's first width (Layout.tsx's RIGHT.initial): Enter on its splitter puts it back. */
const FIRST_WIDTH = 380;

interface Measured {
  /** What is wrong at this width, in words that stay the same from width to width. */
  faults: string[];
  /** The sizes behind each fault, at this width. */
  sizes: Record<string, string>;
  /** Back's and Next's keys: shown on both, on neither, or on one. */
  keys: 'both' | 'neither' | 'one';
}

/**
 * What at this width runs past its own padding, lies over another of Back, Next and the next picture, or differs
 * between Back and Next. Each button's contents are its children in the flow (its words, icons and key), each one's
 * box (a text's own box) inside the button's box less its edge and padding, to half a pixel.
 */
const measure = (win: Page, buttons: string) =>
  win.evaluate((buttons): Measured => {
    const faults: string[] = [];
    const sizes: Record<string, string> = {};
    const named = (el: Element) =>
      el.getAttribute('data-testid') ??
      el.getAttribute('aria-label') ??
      el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
    const shown = (el: Element) => el.getClientRects().length > 0;
    for (const button of document.querySelectorAll(buttons)) {
      if (!(button instanceof HTMLElement) || !shown(button)) continue;
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      const inLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const inRight = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      let left = Infinity;
      let right = -Infinity;
      for (const part of button.childNodes) {
        let rect: DOMRect | null = null;
        if (part instanceof Element) {
          const position = getComputedStyle(part).position;
          if (!shown(part) || position === 'absolute' || position === 'fixed') continue;
          rect = part.getBoundingClientRect();
        } else if (part.nodeType === Node.TEXT_NODE && (part.nodeValue ?? '').trim() !== '') {
          const range = document.createRange();
          range.selectNodeContents(part);
          rect = range.getBoundingClientRect();
        }
        if (!rect || rect.width === 0) continue;
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
      }
      if (left === Infinity) continue;
      if (left < inLeft - 0.5 || right > inRight + 0.5) {
        const fault = `${named(button)}'s contents run past its padding`;
        faults.push(fault);
        sizes[fault] =
          `${(right - left).toFixed(1)} px of contents in ${(inRight - inLeft).toFixed(1)} px inside its padding, ` +
          `the button ${box.width.toFixed(1)} px`;
      }
    }
    // Back, Next and the next picture: side by side, none over another, Back and Next the same width.
    const row = ['show-back', 'show-next', 'next-up']
      .map((id) => document.querySelector(`[data-testid="live-column"] [data-testid="${id}"]`))
      .filter((el): el is Element => el !== null && shown(el))
      .map((el) => ({ el, box: el.getBoundingClientRect() }));
    row.forEach(({ el, box }, i) => {
      for (const other of row.slice(i + 1)) {
        const across = Math.min(box.right, other.box.right) - Math.max(box.left, other.box.left);
        const down = Math.min(box.bottom, other.box.bottom) - Math.max(box.top, other.box.top);
        if (across > 0.5 && down > 0.5)
          faults.push(`${named(el)} and ${named(other.el)} lie over each other`);
      }
    });
    const [back, next, picture] = row;
    if (!back || !next || !picture) {
      faults.push('Back, Next or the next picture is not shown');
      return { faults, sizes, keys: 'neither' };
    }
    if (Math.abs(back.box.width - next.box.width) > 0.5) {
      const fault = 'Back and Next differ in width';
      faults.push(fault);
      sizes[fault] = `Back ${back.box.width.toFixed(1)} px, Next ${next.box.width.toFixed(1)} px`;
    }
    const keyShown = (button: Element) => {
      const key = button.querySelector('kbd');
      return key !== null && shown(key);
    };
    const keys = [keyShown(back.el), keyShown(next.el)];
    return { faults, sizes, keys: keys[0] && keys[1] ? 'both' : !keys[0] && !keys[1] ? 'neither' : 'one' };
  }, buttons);

/** Widths as runs: 336–356, 360. */
function runs(widths: readonly number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < widths.length) {
    let j = i;
    while (j + 1 < widths.length && widths[j + 1] === (widths[j] ?? 0) + 1) j++;
    const from = widths[i] ?? 0;
    const to = widths[j] ?? 0;
    out.push(from === to ? String(from) : `${String(from)}–${String(to)}`);
    i = j + 1;
  }
  return out.join(', ');
}

/**
 * The live column dragged by its splitter from its least to its most, a pixel at a time, `buttons` measured at each
 * width: every fault with the widths it is seen at and its sizes at the first of them, the widths where Back's and
 * Next's keys show on one only, and where they show.
 */
async function sweep(win: Page, buttons: string): Promise<{ faults: string[]; keysAt: number[] }> {
  await win.evaluate(() => document.fonts.ready.then(() => undefined));
  const splitter = win.getByRole('separator', { name: 'Resize the live column', exact: true });
  // The columns laid out for the page's width first. On CI's Mac the window's own resize (to its 1024-wide display)
  // can reach the columns after the page took WINDOW's size, leaving them at the display's width: a resize event
  // makes them read the page's width again, as any resize does.
  await win.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
  });
  await expect(splitter, 'the live column can be widened to its most').toHaveAttribute(
    'aria-valuemax',
    String(MOST),
  );
  await expect(splitter).toHaveAttribute('aria-valuemin', String(LEAST));
  await splitter.focus();
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(LEAST));
  const box = await splitter.boundingBox();
  if (!box) throw new Error('the live column’s splitter is not on the screen');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const seen = new Map<string, { widths: number[]; sizes: string }>();
  const keysAt: number[] = [];
  const oneKey: number[] = [];
  await win.mouse.move(x, y);
  await win.mouse.down();
  for (let width = LEAST; width <= MOST; width++) {
    // Leftwards widens the live column, a pixel at a time.
    await win.mouse.move(x - (width - LEAST), y);
    await expect(splitter).toHaveAttribute('aria-valuenow', String(width));
    const at = await measure(win, buttons);
    for (const fault of at.faults) {
      const known = seen.get(fault);
      if (known) known.widths.push(width);
      else seen.set(fault, { widths: [width], sizes: at.sizes[fault] ?? '' });
    }
    if (at.keys === 'both') keysAt.push(width);
    if (at.keys === 'one') oneKey.push(width);
  }
  await win.mouse.up();
  const faults = [...seen].map(
    ([fault, { widths, sizes }]) =>
      `${fault} with the live column at ${runs(widths)} px${sizes ? ` (at ${String(widths[0])}: ${sizes})` : ''}`,
  );
  if (oneKey.length > 0) faults.push(`Back's and Next's keys show on one only at ${runs(oneKey)} px`);
  return { faults, keysAt };
}

/** Back's and Next's keys at the live column's first width and at its most. */
async function keysAtFirstAndMost(win: Page): Promise<void> {
  const splitter = win.getByRole('separator', { name: 'Resize the live column', exact: true });
  for (const [key, width] of [
    ['Enter', String(FIRST_WIDTH)],
    ['End', String(MOST)],
  ] as const) {
    await splitter.focus();
    await splitter.press(key);
    await expect(splitter).toHaveAttribute('aria-valuenow', width);
    for (const id of ['show-back', 'show-next'])
      await expect(
        win.getByTestId('live-column').getByTestId(id).locator('kbd'),
        `${id}'s key with the live column at ${width} px`,
      ).toBeVisible();
  }
}

const BUTTONS =
  '[data-testid="live-column"] [data-testid="live-still"] button, [data-testid="live-column"] [data-testid="audio-group"] button';

test('Pro Mode: at every width of the live column, Back, Next, the next picture, Oops, the Sound on switches and Audio’s buttons each hold their contents inside their padding, Back and Next the same width and side by side, their keys on both or neither, and shown at the column’s first width and its most', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, WINDOW);
  await expect(win.getByTestId('live-column').getByTestId('show-oops')).toBeVisible();
  await expect(win.getByTestId('live-column').getByTestId('audio-group')).toBeVisible();
  const { faults, keysAt } = await sweep(win, BUTTONS);
  expect(faults, 'what runs past its padding or lies over another, and where').toEqual([]);
  expect(keysAt.length, 'Back’s and Next’s keys show somewhere').toBeGreaterThan(0);
  await keysAtFirstAndMost(win);
  await app.close();
});

test('Simple Mode: at every width of the live column, Back, Next, the next picture, Record, the Sound on switches and Audio’s buttons each hold their contents inside their padding, Back and Next the same width and side by side, their keys on both or neither, and shown at the column’s first width and its most', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, WINDOW);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('live-column').getByTestId('show-next')).toBeVisible();
  const { faults, keysAt } = await sweep(win, BUTTONS);
  expect(faults, 'what runs past its padding or lies over another, and where').toEqual([]);
  expect(keysAt.length, 'Back’s and Next’s keys show somewhere').toBeGreaterThan(0);
  await keysAtFirstAndMost(win);
  await app.close();
});
