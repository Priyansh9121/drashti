import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, openAllSections, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The live column (alpha.21, the owner's "this stays still everything else is scrollable in this window", 22 Nov
 * 2026): the LIVE block (the picture, Back and Next, what plays, the levels) stands still while what is under it
 * scrolls; a window too short to leave that any room scrolls the whole column, as before. Placeholder words only.
 */

/** The owner's own window (22 Nov 2026, alpha.20.1 on his Mac), in CSS pixels. */
const OWNERS_WINDOW = { width: 1410, height: 900 } as const;

/** Enough under LIVE to scroll: Audio's playlists (both modes), and every section open in Pro Mode (alpha.22: all folded at the start). */
async function fillUnderLive(win: Page, live: Locator, mode: 'pro' | 'simple'): Promise<void> {
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    for (let i = 1; i <= 12; i++) {
      const made = await d.music.create(`Placeholder audio ${String(i)}`);
      if (!made.ok) throw new Error('Could not make an audio playlist');
    }
  });
  if (mode === 'pro') await openAllSections(win);
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
  // The last section's last button is reached, inside the window.
  await expect(live.getByTestId('section-osc').getByRole('button').last()).toBeInViewport();
  await expect(win.getByRole('contentinfo', { name: 'Status' })).toBeInViewport({ ratio: 1 });
  await app.close();
});

test('a paused video in the owner’s narrowest live column (1410 × 900, both columns at their least): its row says so by its Play button alone, its times show whole inside the column, and nothing of the LIVE block lies over the levels', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, OWNERS_WINDOW);
  // His columns (22 Nov 2026): each at its least, as Home on its splitter puts it.
  for (const name of ['Resize the playlists', 'Resize the live column']) {
    const splitter = win.getByRole('separator', { name, exact: true });
    await splitter.focus();
    await splitter.press('Home');
  }
  const dir = mkdtempSync(join(tmpdir(), 'drashti-live-column-'));
  const file = await makeTestVideo(win, join(dir, 'Placeholder paused talk.webm'), {
    seconds: 12,
    hue: 200,
    tone: 440,
  });
  const [mediaId = ''] = await importAndGetIds(win, [file]);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fill', loop: true },
      }),
    mediaId,
  );
  const live = win.getByRole('complementary', { name: 'Live', exact: true });
  const bg = live.locator('[data-testid="time-bar-row"][data-playing="background"]');
  await expect(bg.getByRole('button', { name: 'Pause' })).toBeEnabled({ timeout: 15_000 });
  await bg.getByRole('button', { name: 'Pause' }).click();
  await expect(bg).toHaveAttribute('data-paused', 'true');
  await expect(bg.getByRole('button', { name: 'Play' })).toBeVisible();
  // No word for it (his "remove where its written paused, it takes up much space"): the Play button says it.
  await expect(bg.getByText('Paused', { exact: true })).toHaveCount(0);
  await expect(bg.getByTestId('time-bar-left')).toHaveText(/^-\d+:\d\d$/u);
  const problems = await live.evaluate((column) => {
    const out: string[] = [];
    const edge = column.getBoundingClientRect();
    const row = column.querySelector('[data-testid="time-bar-row"][data-playing="background"]');
    const named = (el: Element) =>
      el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
    for (const el of row?.querySelectorAll('button, [role="slider"], [data-testid^="time-bar-"]') ?? []) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < edge.left - 0.5 || r.right > edge.right + 0.5)
        out.push(`${named(el)} sticks out of the column`);
    }
    for (const id of ['time-bar-elapsed', 'time-bar-left']) {
      const time = row?.querySelector(`[data-testid="${id}"]`);
      if (time instanceof HTMLElement && time.scrollWidth > time.clientWidth + 0.5) out.push(`${id} is cut`);
    }
    const levels = column.querySelector('[data-testid="sound-levels"]');
    const under = levels?.getBoundingClientRect();
    if (!levels || !under) return [...out, 'no levels'];
    for (const el of column.querySelectorAll('[data-testid="live-still"] *')) {
      if (el === levels || levels.contains(el) || el.contains(levels)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const across = r.right > under.left + 0.5 && r.left < under.right - 0.5;
      if (across && r.bottom > under.top + 0.5 && r.top < under.bottom - 0.5)
        out.push(`${named(el)} lies over the levels`);
    }
    return out;
  });
  expect(problems).toEqual([]);
  await app.close();
});
