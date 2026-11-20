import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';
import { makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

test('Shuffle keeps one order after restart; Repeat all and automatic Next follow exactly the Next picture', async () => {
  test.setTimeout(180_000);
  const first = await launchApp();
  let app = first.app;
  let win = await operatorPage(app);
  try {
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-shuffle-'));
    const files: string[] = [];
    for (let i = 0; i < 3; i++)
      files.push(
        await makeTestVideo(win, join(dir, `Placeholder ${String(i)}.webm`), { seconds: 3, hue: i * 120 }),
      );
    const media = await importAndGetIds(win, files);
    const made = await win.evaluate(async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder shuffle', null, false);
      if (!list.ok) throw new Error(list.message);
      const id = list.ids[0] ?? '';
      const added = await d.playlists.addItems(
        id,
        null,
        ids.map((mediaId) => ({ kind: 'media', mediaId })),
      );
      if (!added.ok) throw new Error(added.message);
      for (const item of added.ids) await d.playlists.setWhenEnds(item, 'next');
      return { id, items: added.ids };
    }, media);
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder shuffle' }).click();
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitemcheckbox', { name: 'Shuffle', exact: true }).click();
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitemcheckbox', { name: 'Repeat all', exact: true }).click();
    await expect(win.getByTestId('playlist-play-options')).toHaveText('Shuffled · Repeat all');
    const order: string[] = [];
    // Starting a row still means its numbered place on screen; the following rows use the saved draw.
    await win.getByTestId('playlist-item').first().click();
    await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'pausePlaying',
        playing: { layer: 'background' },
      }),
    );
    for (let i = 0; i < 3; i++) {
      const before = await state(win);
      const current = before.live.playlist?.itemId ?? '';
      order.push(current);
      const next = before.next;
      expect(next?.kind).toBe('media');
      if (next?.kind !== 'media') throw new Error('Next has no media picture');
      await expect(win.getByTestId('next-up')).toHaveAccessibleName(`Next up: ${next.label}`);
      await win.getByTestId('show-next').click();
      await expect.poll(async () => (await state(win)).live.playlist?.itemId).toBe(next.itemId);
      await win.evaluate(() =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'pausePlaying',
          playing: { layer: 'background' },
        }),
      );
    }
    expect(new Set(order).size).toBe(3);
    expect(new Set(order)).toEqual(new Set(made.items));
    expect((await state(win)).live.playlist?.itemId).toBe(order[0]);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearAll' }));
    await app.close();
    const again = await relaunchApp(first.userData);
    app = again.app;
    win = await operatorPage(app);
    await operatorReady(win);
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder shuffle' }).click();
    await expect(win.getByTestId('playlist-play-options')).toHaveText('Shuffled · Repeat all');
    await win.getByTestId('playlist-item').first().click();
    for (let i = 1; i <= 4; i++) {
      const wanted = order[i % 3];
      await expect.poll(async () => (await state(win)).live.playlist?.itemId, { timeout: 5000 }).toBe(wanted);
      const next = (await state(win)).next;
      expect(next?.kind === 'media' ? next.itemId : '').toBe(order[(i + 1) % 3]);
    }
  } finally {
    await app.close();
  }
});
