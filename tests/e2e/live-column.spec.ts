import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The live column (alpha.21, the owner's "this stays still everything else is scrollable in this window", 22 Nov
 * 2026): the LIVE block (the picture, Back and Next, what plays, the levels) stands still while what is under it
 * scrolls; a window too short to leave that any room scrolls the whole column, as before. Placeholder words only.
 */

/** The owner's own window (22 Nov 2026, alpha.20.1 on his Mac), in CSS pixels. */
const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

/** Enough under LIVE to scroll: Audio's playlists (both modes), and More tools open in Pro Mode. */
async function fillUnderLive(win: Page, live: Locator, mode: 'pro' | 'simple'): Promise<void> {
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    for (let i = 1; i <= 12; i++) {
      const made = await d.music.create(`Placeholder audio ${String(i)}`);
      if (!made.ok) throw new Error('Could not make an audio playlist');
    }
  });
  if (mode === 'pro') await live.getByTestId('group-more-tools-toggle').click();
}

/** Every part of the column that scrolls, scrolled to its end; how far the furthest went. */
const scrollToEnd = (live: Locator) =>
  live.evaluate((column) => {
    let most = 0;
    for (const el of [column, ...column.querySelectorAll('*')]) {
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 1) continue;
      if (!['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) continue;
      el.scrollTop = el.scrollHeight;
      most = Math.max(most, el.scrollTop);
    }
    return most;
  });

for (const mode of ['pro', 'simple'] as const)
  test(`${mode === 'pro' ? 'Pro' : 'Simple'} Mode at the owner's 1410 × 900: the LIVE block stands still while what is under it scrolls`, async () => {
    const { app } = await launchApp();
    const win = await operatorPage(app);
    await operatorReady(win);
    if (mode === 'simple')
      await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await sizeOperatorWindow(app, win, OWNERS_WINDOW);
    const live = win.getByRole('complementary', { name: 'Live', exact: true });
    await fillUnderLive(win, live, mode);
    const levels = live.getByTestId('sound-levels');
    await expect(levels).toBeInViewport({ ratio: 1 });
    const before = await levels.boundingBox();
    expect(await scrollToEnd(live), 'something under LIVE scrolls').toBeGreaterThan(0);
    // The last of what is under it is reached, and the block has not moved.
    await expect(live.getByTestId('audio-group')).toBeVisible();
    expect((await levels.boundingBox())?.y).toBe(before?.y);
    await expect(levels).toBeInViewport({ ratio: 1 });
    await expect(live.getByTestId('live-preview')).toBeInViewport({ ratio: 1 });
    await expect(live.getByTestId('show-next')).toBeInViewport({ ratio: 1 });
    await expect(live).toHaveAttribute('data-still', 'true');
    await app.close();
  });

test('in CI’s 1024 × 645 window, all of the column can be reached: under a still LIVE block at least 140 px scroll, or else the whole column scrolls', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const live = win.getByRole('complementary', { name: 'Live', exact: true });
  await fillUnderLive(win, live, 'pro');
  await expect(live).toHaveAttribute('data-still', /^(true|false)$/u);
  const still = (await live.getAttribute('data-still')) === 'true';
  const rest = live.getByTestId('live-rest');
  if (still) {
    const room = await rest.evaluate((el) => el.clientHeight);
    expect(room, 'the room under the still LIVE block').toBeGreaterThanOrEqual(140);
  }
  expect(await scrollToEnd(live)).toBeGreaterThan(0);
  // The last of More tools is reached, inside the window.
  await expect(live.getByTestId('more-tools').getByRole('button').last()).toBeInViewport();
  await expect(win.getByRole('contentinfo', { name: 'Status' })).toBeInViewport({ ratio: 1 });
  await app.close();
});
