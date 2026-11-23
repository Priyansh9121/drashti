import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { sizeOperatorWindow } from './window-size';

/*
 * Both side columns at their least, as the owner keeps them (22 Nov 2026, alpha.20.1 at his 1410 × 900: "dont like the
 * design here. frontend issue."): the Wallpapers heading whole beside its buttons, a deleted playlist's undo note
 * whole with its Undo, and Back, Next and the next picture each whole in their row. Placeholder names only.
 */

const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

/** Both side columns at their least, as Home on each splitter puts them. */
async function narrowest(win: Page): Promise<void> {
  for (const name of ['Resize the playlists', 'Resize the live column']) {
    const splitter = win.getByRole('separator', { name, exact: true });
    await splitter.focus();
    await splitter.press('Home');
  }
}

/** What in `selector` is cut (its words run past it), sticks out of `column`, or lies over another of them. */
const cutOrOver = (win: Page, column: string, selector: string) =>
  win.evaluate(
    ({ column, selector }) => {
      const out: string[] = [];
      const edge = document.querySelector(column)?.getBoundingClientRect();
      if (!edge) return [`no ${column}`];
      const parts = [...document.querySelectorAll(selector)].filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0,
      );
      if (parts.length === 0) return [`nothing for ${selector}`];
      const named = (el: Element) =>
        el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30);
      parts.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1)
          out.push(`${named(el)} is cut (${String(el.scrollWidth)} > ${String(el.clientWidth)} px)`);
        if (r.left < edge.left - 0.5 || r.right > edge.right + 0.5)
          out.push(`${named(el)} sticks out of its column`);
        for (const other of parts.slice(i + 1)) {
          if (other.contains(el) || el.contains(other)) continue;
          const o = other.getBoundingClientRect();
          const across = Math.min(r.right, o.right) - Math.max(r.left, o.left);
          const down = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
          if (across > 0.5 && down > 0.5) out.push(`${named(el)} and ${named(other)} lie over each other`);
        }
      });
      return out;
    },
    { column, selector },
  );

test('both side columns at their least, at the owner’s 1410 × 900: the Wallpapers heading, a deleted playlist’s undo note, and Back, Next and the next picture, each whole and none over another', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, OWNERS_WINDOW);
  await narrowest(win);
  const left = '[data-testid="column-left"]';
  const right = 'aside[aria-label="Live"]';
  await expect(win.locator(left)).toBeVisible();

  // The Wallpapers heading and its buttons.
  const wallpapers = win.getByTestId('wallpapers-import');
  await expect(wallpapers).toBeVisible();
  expect(
    await cutOrOver(
      win,
      left,
      '[data-testid="wallpapers-import"], [data-testid="wallpapers-import"] ~ button, h2:has(+ [data-testid="wallpapers-import"])',
    ),
    'the Wallpapers heading',
  ).toEqual([]);
  // Import… keeps its name, its words shown or not.
  await expect(win.getByRole('button', { name: 'Import…' }).and(wallpapers)).toHaveCount(1);

  // A deleted playlist's note, with Undo.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.playlists.create('Placeholder Evening Kirtan', null, false),
  );
  const panel = win.getByTestId('playlists');
  const node = panel.getByTestId('playlist-node').filter({ hasText: 'Placeholder Evening Kirtan' });
  await node.click();
  await panel.getByRole('button', { name: 'Delete playlist “Placeholder Evening Kirtan”' }).click();
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete' }).click();
  const undo = win.getByTestId('undo-removal');
  await expect(undo).toContainText('Deleted playlist “Placeholder Evening Kirtan”');
  expect(await cutOrOver(win, left, '[data-testid="undo-removal"] > *'), 'the undo note').toEqual([]);

  // Back, Next and the next picture.
  expect(
    await cutOrOver(
      win,
      right,
      '[data-testid="show-back"], [data-testid="show-next"], [data-testid="next-up"]',
    ),
    'Back, Next and the next picture',
  ).toEqual([]);
  await app.close();
});
