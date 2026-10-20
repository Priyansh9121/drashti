import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { settled } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * The left column keeps to itself (Session 44, step 1). In alpha.8, with an empty library and the
 * Undo notice for a deleted playlist showing, the library's empty place drew out of its panel: "The
 * library is empty", its words and "Import…" lay over the layer bar, on top of Clear all. Nothing in
 * the left column may draw outside it or over the layer bar, at 1280 × 720 and at the smallest window
 * Drashti allows, and a notice takes its room inside the column.
 */

/**
 * Every part of the left column that is drawn (an element or a line of its words, as far as its
 * scrolling and clipping ancestors let it be seen) outside the column or over the layer bar.
 */
async function strays(win: Page): Promise<string[]> {
  return win.evaluate(() => {
    const column = document.querySelector('[data-testid="column-left"]');
    const bar = document.querySelector('[data-testid="layer-bar"]');
    if (!column || !bar) return ['the left column or the layer bar is missing'];
    const c = column.getBoundingClientRect();
    const floor = Math.min(c.bottom, bar.getBoundingClientRect().top);
    interface Box {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    /** What clips `el`'s drawing: every ancestor up to the column that does not let it overflow (and `el` itself, for its words). */
    const clipOf = (el: Element, self: boolean): Box | null => {
      let box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      // The column's own clipping is a last guard, not counted: what is in it must fit by itself.
      for (let a: Element | null = self ? el : el.parentElement; a && a !== column; a = a.parentElement) {
        const s = getComputedStyle(a);
        // A clip path (the screen-reader-only lines) or hiding draws nothing at all.
        if (s.clipPath !== 'none' || s.visibility === 'hidden' || s.display === 'none') return null;
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const r = a.getBoundingClientRect();
          box = {
            left: Math.max(box.left, r.left),
            top: Math.max(box.top, r.top),
            right: Math.min(box.right, r.right),
            bottom: Math.min(box.bottom, r.bottom),
          };
        }
      }
      return box;
    };
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid');
      const words = el.textContent.trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${words ? ` “${words}”` : ''}`;
    };
    const out: string[] = [];
    const check = (r: DOMRect, clip: Box | null, what: string) => {
      if (!clip) return;
      const left = Math.max(r.left, clip.left);
      const right = Math.min(r.right, clip.right);
      const top = Math.max(r.top, clip.top);
      const bottom = Math.min(r.bottom, clip.bottom);
      // Nothing of it is seen.
      if (right - left < 0.5 || bottom - top < 0.5) return;
      if (left < c.left - 0.5 || right > c.right + 0.5 || top < c.top - 0.5 || bottom > floor + 0.5)
        out.push(
          `${what} is drawn at ${String(Math.round(left))},${String(Math.round(top))} to ${String(Math.round(right))},${String(Math.round(bottom))} (the column ends at ${String(Math.round(c.right))},${String(Math.round(floor))})`,
        );
    };
    check(c, { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }, 'the left column');
    for (const el of column.querySelectorAll('*')) {
      const own = getComputedStyle(el);
      if (own.clipPath !== 'none' || own.visibility === 'hidden') continue;
      check(el.getBoundingClientRect(), clipOf(el, false), name(el));
    }
    const walker = document.createTreeWalker(column, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const words = (n.textContent ?? '').trim();
      const parent = n.parentElement;
      if (!words || !parent) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        check(r, clipOf(parent, true), `the words “${words.slice(0, 40)}”`);
    }
    return out;
  });
}

/** The operator window at the smallest size Drashti allows it, its page laid out at that window's content size. */
async function smallestWindow(
  app: ElectronApplication,
  win: Page,
): Promise<{ width: number; height: number }> {
  const [width, height] = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'));
    if (!w) return [0, 0];
    const [minWidth = 0, minHeight = 0] = w.getMinimumSize();
    w.setSize(minWidth, minHeight);
    return w.getContentSize();
  });
  expect(width, 'the operator window has a smallest size').toBeGreaterThan(0);
  const size = { width: width ?? 0, height: height ?? 0 };
  await win.setViewportSize(size);
  return size;
}

test('nothing in the left column draws outside it or over the layer bar, with an empty library and the Undo notice', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });

  // An empty library: a new one holds two sample presentations.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const all = await d.library.listPresentations();
    await d.library.removePresentations(all.map((p) => p.id));
    await d.playlists.create('New', null, false);
  });
  await win.reload();
  await operatorReady(win);

  // A playlist made and deleted: its Undo notice shows in the left column.
  const node = win.getByTestId('playlists').getByTestId('playlist-node').filter({ hasText: 'New' });
  await node.click();
  await win.getByRole('button', { name: 'Delete playlist “New”' }).click();
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(win.getByTestId('undo-removal')).toContainText('Deleted playlist “New”');
  await expect(win.getByTestId('column-left').getByTestId('undo-removal')).toBeVisible();

  const found: Record<string, string[]> = {};
  for (const size of [{ width: 1280, height: 720 }, await smallestWindow(app, win)]) {
    await win.setViewportSize(size);
    await settled(win);
    found[`${String(size.width)} × ${String(size.height)}`] = await strays(win);
  }
  expect(Object.values(found).flat(), JSON.stringify(found, null, 1)).toEqual([]);
  await app.close();
});
