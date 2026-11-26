import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { helpOn } from './help';
import { launchApp, openSection, operatorPage, operatorReady } from './helpers';
import { sizeOperatorWindow } from './window-size';

/*
 * The live column at every width it can have (alpha.22, the owner's report on alpha.21, 24 Nov 2026: "UI Front end
 * issue.", in his live column at its least, Next's word touched its left edge and its key ran past its right). Its
 * splitter dragged from the column's least to its most, a pixel at a time, in Pro and Simple Mode: at each width every
 * button under LIVE and in Audio (opened: the test fails if none of Audio's buttons is measured) holds its contents
 * inside its own padding (its words, icons and key whole), Back, Next and the next picture lie side by side, none over
 * another, Back and Next are the same width, and their keys show on both or on neither. At the column's first width
 * and at its most, the keys show. Only widths are measured, never the column's height. Placeholder content only.
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
  /** How many buttons of Audio's body were measured (none: Audio folded, or its buttons gone). */
  audio: number;
  /** The test ids of the buttons whose contents were measured (Back's, Next's, Oops'). */
  measured: string[];
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
    let audio = 0;
    const measured: string[] = [];
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
      // What was measured: Audio's body (its header's toggle, ? and + show folded too), and each button by its test id.
      if (button.closest('[data-testid="audio-group"] [data-testid="music-panel"]')) audio++;
      const id = button.getAttribute('data-testid');
      if (id !== null) measured.push(id);
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
      return { faults, sizes, keys: 'neither', audio, measured };
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
    return {
      faults,
      sizes,
      keys: keys[0] && keys[1] ? 'both' : !keys[0] && !keys[1] ? 'neither' : 'one',
      audio,
      measured,
    };
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
 * Next's keys show on one only, where `required` (test ids) or Audio's buttons were not measured, and whether the
 * keys show in one run from the column's first width or less to its most.
 */
async function sweep(
  win: Page,
  buttons: string,
  required: readonly string[],
): Promise<{ faults: string[]; keysAt: number[] }> {
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
  const noAudio: number[] = [];
  const unmeasured = new Map<string, number[]>();
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
    // Audio open, and its buttons among those measured, at every width: a folded Audio would pass unmeasured.
    if (at.audio === 0) noAudio.push(width);
    // Back's and Next's own contents (the owner's fault) measured at every width, whatever holds them.
    for (const id of required)
      if (!at.measured.includes(id)) unmeasured.set(id, [...(unmeasured.get(id) ?? []), width]);
  }
  await win.mouse.up();
  const faults = [...seen].map(
    ([fault, { widths, sizes }]) =>
      `${fault} with the live column at ${runs(widths)} px${sizes ? ` (at ${String(widths[0])}: ${sizes})` : ''}`,
  );
  if (oneKey.length > 0) faults.push(`Back's and Next's keys show on one only at ${runs(oneKey)} px`);
  if (noAudio.length > 0) faults.push(`none of Audio's buttons was measured at ${runs(noAudio)} px`);
  for (const [id, widths] of unmeasured)
    faults.push(`${id}'s contents were not measured at ${runs(widths)} px`);
  // The keys show wherever both have room: one run, from the column's first width or less to its most.
  const keysRun = /^(\d+)–(\d+)$/u.exec(runs(keysAt));
  if (!keysRun || Number(keysRun[1]) > FIRST_WIDTH || Number(keysRun[2]) !== MOST)
    faults.push(
      `Back's and Next's keys show at ${runs(keysAt) || 'no width'}, not in one run from ${String(FIRST_WIDTH)} px or less to ${String(MOST)} px`,
    );
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
  await helpOn(win);
  await sizeOperatorWindow(app, win, WINDOW);
  await expect(win.getByTestId('live-column').getByTestId('show-oops')).toBeVisible();
  // Audio, a section under LIVE folded at each start (alpha.22), opened to measure its buttons.
  await openSection(win, 'audio');
  await expect(win.getByTestId('live-column').getByTestId('music-empty').getByRole('button')).toHaveCount(3);
  const { faults, keysAt } = await sweep(win, BUTTONS, ['show-back', 'show-next', 'show-oops']);
  expect(faults, 'what runs past its padding or lies over another, and where').toEqual([]);
  expect(keysAt.length, 'Back’s and Next’s keys show somewhere').toBeGreaterThan(0);
  await keysAtFirstAndMost(win);
  await app.close();
});

test('Simple Mode: at every width of the live column, Back, Next, the next picture, Record, the Sound on switches and Audio’s buttons each hold their contents inside their padding, Back and Next the same width and side by side, their keys on both or neither, and shown at the column’s first width and its most', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await helpOn(win);
  await sizeOperatorWindow(app, win, WINDOW);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('live-column').getByTestId('show-next')).toBeVisible();
  // Simple Mode's Audio opens as before; opened here in case it was left folded.
  await openSection(win, 'audio');
  await expect(win.getByTestId('live-column').getByTestId('music-empty').getByRole('button')).toHaveCount(3);
  const { faults, keysAt } = await sweep(win, BUTTONS, ['show-back', 'show-next']);
  expect(faults, 'what runs past its padding or lies over another, and where').toEqual([]);
  expect(keysAt.length, 'Back’s and Next’s keys show somewhere').toBeGreaterThan(0);
  await keysAtFirstAndMost(win);
  await app.close();
});
