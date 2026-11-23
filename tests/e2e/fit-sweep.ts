import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { settled } from './a11y';

/*
 * The whole-app fit pass (alpha.21, the owner's "dont like the design here. frontend issue." and "all good fit in 21",
 * 22 Nov 2026): a window or dialog at a size, and everything in it that is cut, lies over something else, runs out of
 * its box or of the window, or scrolls sideways, and every target too small to press. Each finding is said by name, so
 * one run lists them all (fit-sweep.spec.ts).
 */

/** The owner's window (alpha.20.1 on his Mac, 22 Nov 2026: about 1410 CSS pixels wide). */
export const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Each of Drashti's windows the sweep opens, by its page. */
export type WindowPage =
  'index.html' | 'slide-editor.html' | 'access-list.html' | 'lock.html' | 'lower-thirds.html' | 'zoom.html';

/** The smallest content Drashti allows a window of its: its least size less its frame, on this system. */
export function smallestContent(app: ElectronApplication, page: WindowPage): Promise<Size> {
  return app.evaluate(({ BrowserWindow }, part) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes(part));
    if (!w) throw new Error(`no window shows ${part}`);
    const [leastWidth = 0, leastHeight = 0] = w.getMinimumSize();
    const [outerWidth = 0, outerHeight = 0] = w.getSize();
    const [innerWidth = 0, innerHeight = 0] = w.getContentSize();
    return {
      width: leastWidth - (outerWidth - innerWidth),
      height: leastHeight - (outerHeight - innerHeight),
    };
  }, page);
}

/**
 * A window at `size` (CSS pixels): its content made that size where the display has room for it, and its page laid
 * out at exactly that size either way, as on CI. Waits until the page has taken the size.
 */
export async function sizeWindow(
  app: ElectronApplication,
  page: Page,
  part: WindowPage,
  size: Size,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { part, want }) => {
      BrowserWindow.getAllWindows()
        .find((b) => b.webContents.getURL().includes(part))
        ?.setContentSize(want.width, want.height);
    },
    { part, want: size },
  );
  await page.setViewportSize(size);
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([size.width, size.height]);
}

/**
 * What in `root` does not fit, each said once: words cut (cut with "…" only where the whole name shows on hover, as
 * Truncate does, design.md §7), a control or words cut by a box that does not scroll that way or by the window, two
 * of them lying over each other, one running out of the bordered box it is in, and anything scrolling sideways but
 * what is made to (`sideways`, by test id: the Access List's table, design.md §51). The screens' pictures
 * (data-a11y-picture) are the slides' own and left out.
 */
function problemsIn(root: Element, sideways: readonly string[]): string[] {
  const out: string[] = [];
  const say = (line: string) => {
    if (!out.includes(line)) out.push(line);
  };
  const vw = innerWidth;
  const vh = innerHeight;
  const label = (el: Element): string => {
    const id = el.getAttribute('data-testid');
    const aria = el.getAttribute('aria-label');
    const text = el.textContent.replace(/\s+/gu, ' ').trim();
    const words = text ? `“${text.slice(0, 48)}${text.length > 48 ? '…' : ''}”` : '';
    return `${el.tagName.toLowerCase()} ${id ?? aria ?? words}`.trim();
  };
  const CONTROL =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [role="slider"], [role="spinbutton"], [role="combobox"]';
  const ownWords = (el: Element) =>
    [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
  const shown = (el: HTMLElement) =>
    el.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
    });
  interface Box {
    l: number;
    t: number;
    r: number;
    b: number;
  }
  const boxOf = (r: DOMRect): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  /** Where an element shows what is inside it: within its borders, its scroll bars left out. */
  const inside = (el: HTMLElement): Box => {
    const r = el.getBoundingClientRect();
    const l = r.left + el.clientLeft;
    const t = r.top + el.clientTop;
    return { l, t, r: l + el.clientWidth, b: t + el.clientHeight };
  };
  const scrolls = (o: string) => o === 'auto' || o === 'scroll';

  const everything = [root, ...root.querySelectorAll('*')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.closest('[data-a11y-picture]'),
  );
  // The window and the root itself.
  if (document.documentElement.scrollWidth > vw + 1)
    say(`the window scrolls sideways (${String(document.documentElement.scrollWidth)} > ${String(vw)} px)`);
  const whole = root.getBoundingClientRect();
  // A dialog or a panel whole in the window (a whole window's page is judged by its parts).
  const page = root === document.body || root === document.documentElement;
  if (!page && (whole.left < -0.5 || whole.top < -0.5 || whole.right > vw + 0.5 || whole.bottom > vh + 0.5))
    say(
      `${label(root)} is not whole in the window (${String(Math.round(whole.left))},${String(Math.round(whole.top))} to ${String(Math.round(whole.right))},${String(Math.round(whole.bottom))} in ${String(vw)} × ${String(vh)})`,
    );
  // Anything that scrolls sideways.
  for (const el of everything) {
    const cs = getComputedStyle(el);
    const made = sideways.includes(el.getAttribute('data-testid') ?? '');
    if (!made && scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && shown(el))
      say(`${label(el)} scrolls sideways (${String(el.scrollWidth)} > ${String(el.clientWidth)} px)`);
  }

  const parts = everything.filter((el) => {
    if (['SCRIPT', 'STYLE', 'OPTION', 'TITLE'].includes(el.tagName)) return false;
    if (!(el.matches(CONTROL) || ownWords(el))) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && shown(el);
  });
  const docScrolls =
    document.documentElement.scrollHeight > vh + 1 &&
    getComputedStyle(document.documentElement).overflowY !== 'hidden' &&
    getComputedStyle(document.body).overflowY !== 'hidden';
  const seen = new Map<HTMLElement, Box>();
  for (const el of parts) {
    const cs = getComputedStyle(el);
    // Its words, whole.
    if (!el.matches('input, textarea, select') && el.clientWidth > 0) {
      const ellipsis = cs.textOverflow === 'ellipsis';
      const onHover = (el.closest('[title]')?.getAttribute('title') ?? '').trim() !== '';
      if (el.scrollWidth > el.clientWidth + 1 && !(ellipsis && onHover))
        say(
          `${label(el)}: its words do not fit (${String(el.scrollWidth)} > ${String(el.clientWidth)} px)${ellipsis ? ', cut with “…” and not shown whole on hover' : ''}`,
        );
      const clamped = cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== '' && onHover;
      if (
        !scrolls(cs.overflowY) &&
        cs.overflowY !== 'visible' &&
        el.scrollHeight > el.clientHeight + 2 &&
        !clamped
      )
        say(
          `${label(el)}: its words are cut below (${String(el.scrollHeight)} > ${String(el.clientHeight)} px)`,
        );
    }
    // What of it shows: cut by a box that does not scroll that way, or by the window.
    let box = boxOf(el.getBoundingClientRect());
    let fixed = cs.position === 'fixed';
    let gone = false;
    for (let a = el.parentElement; a && !gone; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.position === 'fixed') fixed = true;
      if (as.overflowX === 'visible' && as.overflowY === 'visible') continue;
      const edge = inside(a);
      // Cut by text that ends in "…": said of that text itself.
      const byEllipsis = as.textOverflow === 'ellipsis';
      if (as.overflowX !== 'visible') {
        if (!scrolls(as.overflowX) && !byEllipsis && (box.l < edge.l - 0.5 || box.r > edge.r + 0.5))
          say(`${label(el)} is cut sideways by ${label(a)}`);
        box = { ...box, l: Math.max(box.l, edge.l), r: Math.min(box.r, edge.r) };
      }
      if (as.overflowY !== 'visible') {
        if (!scrolls(as.overflowY) && !byEllipsis && (box.t < edge.t - 0.5 || box.b > edge.b + 0.5))
          say(`${label(el)} is cut at its top or bottom by ${label(a)}`);
        box = { ...box, t: Math.max(box.t, edge.t), b: Math.min(box.b, edge.b) };
      }
      // Scrolled out of sight: nothing of it to judge.
      if (box.r - box.l <= 0.5 || box.b - box.t <= 0.5) gone = true;
    }
    if (gone) continue;
    if (box.l < -0.5 || box.r > vw + 0.5) say(`${label(el)} runs off the side of the window`);
    if ((fixed || !docScrolls) && (box.t < -0.5 || box.b > vh + 0.5))
      say(`${label(el)} runs off the top or bottom of the window`);
    seen.set(el, box);
    // Inside the bordered box it is in (a card, a field, a frame), unless that box is a control of its own: what of it
    // shows (a row scrolled half out of sight in a list is judged by its half in sight).
    for (let a = el.parentElement; a && root.contains(a); a = a.parentElement) {
      const as = getComputedStyle(a);
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].every(
        (side) => parseFloat(as.getPropertyValue(`border-${side.toLowerCase()}-width`)) >= 1,
      );
      if (!bordered) continue;
      if (a.matches(CONTROL)) break;
      const r = a.getBoundingClientRect();
      if (box.l < r.left - 0.5 || box.r > r.right + 0.5 || box.t < r.top - 0.5 || box.b > r.bottom + 0.5)
        say(`${label(el)} runs out of ${label(a)}`);
      break;
    }
  }

  // None over another: their boxes (an inline one's, line by line), as much of each as shows.
  const shownParts = [...seen.entries()].map(([el, clip]) => {
    const lines =
      getComputedStyle(el).display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
    const boxes = lines
      .map(boxOf)
      .map((b) => ({
        l: Math.max(b.l, clip.l),
        t: Math.max(b.t, clip.t),
        r: Math.min(b.r, clip.r),
        b: Math.min(b.b, clip.b),
      }))
      .filter((b) => b.r - b.l > 1 && b.b - b.t > 1);
    return { el, boxes };
  });
  for (const [i, one] of shownParts.entries()) {
    for (const other of shownParts.slice(i + 1)) {
      if (one.el.contains(other.el) || other.el.contains(one.el)) continue;
      const over = one.boxes.some((a) =>
        other.boxes.some(
          (b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1,
        ),
      );
      if (over) say(`${label(one.el)} and ${label(other.el)} lie over each other`);
    }
  }
  return out.length > 40 ? [...out.slice(0, 40), `… and ${String(out.length - 40)} more`] : out;
}

type AxeWindow = typeof globalThis & { axe?: typeof axe };

/** The targets in `root` smaller than 24 × 24 px without the room round them (axe's target-size, WCAG 2.5.8). */
async function smallTargets(root: Locator): Promise<string[]> {
  const page = root.page();
  if (!(await page.evaluate(() => Boolean((globalThis as AxeWindow).axe)))) await page.evaluate(axe.source);
  return root.evaluate(async (el) => {
    const engine = (globalThis as AxeWindow).axe;
    if (!engine) throw new Error('axe-core did not load');
    el.setAttribute('data-fit-sweep', '');
    try {
      const result = await engine.run(
        { include: [['[data-fit-sweep]']], exclude: [['[data-a11y-picture]']] },
        { runOnly: { type: 'rule', values: ['target-size'] }, resultTypes: ['violations'] },
      );
      return result.violations.flatMap((v) =>
        v.nodes.map((n) => `${n.target.join(' ')} is too small a target: ${n.failureSummary ?? ''}`),
      );
    } finally {
      el.removeAttribute('data-fit-sweep');
    }
  });
}

/**
 * `root` at each size in turn, its window resized round it: what does not fit at each, said by name (soft, so one run
 * lists every window's and every dialog's). A layout that follows the size a moment later (a ResizeObserver's) is
 * given until it settles.
 */
export async function sweep(
  app: ElectronApplication,
  page: Page,
  part: WindowPage,
  root: Locator,
  what: string,
  sizes: readonly Size[],
  /** What is made to scroll sideways, by test id. */
  sideways: readonly string[] = [],
): Promise<void> {
  for (const size of sizes) {
    const at = `${what} at ${String(size.width)} × ${String(size.height)}`;
    await sizeWindow(app, page, part, size);
    await expect(root, at).toBeVisible();
    await settled(page);
    let found: string[] = [];
    await expect
      .poll(
        async () => {
          found = await root.evaluate(problemsIn, sideways);
          return found;
        },
        { timeout: 3000, message: `${at}: settled` },
      )
      .toEqual([])
      .catch(() => undefined);
    found = [...found, ...(await smallTargets(root))];
    expect.soft(found, at).toEqual([]);
  }
}

/**
 * One window or dialog of the sweep, as a step: opened, swept, closed. One that cannot be opened is said (soft) and the
 * window is brought back (its dialogs closed) for the next.
 */
export async function each(page: Page, what: string, body: () => Promise<void>): Promise<void> {
  await test.step(what, async () => {
    try {
      await body();
    } catch (error) {
      const first = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
      expect.soft(first, `${what}: opened and swept`).toBe('');
      for (let i = 0; i < 3; i++) {
        if (page.isClosed() || (await page.locator('[aria-modal="true"]').count()) === 0) break;
        await page.keyboard.press('Escape');
      }
    }
  });
}
