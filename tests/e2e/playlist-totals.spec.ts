import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';

test('playlist totals add 0:10 and 0:20; Ends at follows the remaining automatic chain and is absent with Repeat all', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-totals-'));
    const files = [
      await makeTestVideo(win, join(dir, 'Placeholder ten.webm'), { seconds: 10 }),
      await makeTestVideo(win, join(dir, 'Placeholder twenty.webm'), { seconds: 20, hue: 20 }),
    ];
    const media = await importAndGetIds(win, files);
    await win.evaluate(async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create('Placeholder totals', null, false);
      if (!list.ok) throw new Error(list.message);
      const items = await d.playlists.addItems(
        list.ids[0] ?? '',
        null,
        ids.map((mediaId) => ({ kind: 'media', mediaId })),
      );
      if (!items.ok) throw new Error(items.message);
      await d.playlists.setWhenEnds(items.ids[0] ?? '', 'next');
    }, media);
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder totals' }).click();
    const panel = win.getByTestId('open-playlist');
    await expect(panel.getByTestId('playlist-totals')).toHaveText('2 rows · videos and sounds 0:30');
    await panel.getByTestId('playlist-item').first().click();
    await expect(panel.getByTestId('playlist-ends-at')).toHaveText(/^Ends at /u);
    const times = await win.evaluate(async () => {
      const snap = await (globalThis as PageGlobals).drashti.engine.snapshot();
      const bg = snap.state.layers.background;
      if (bg?.kind !== 'media') throw new Error('No background video');
      const shown = Number(
        document.querySelector('[data-testid="playlist-ends-at"]')?.getAttribute('data-ends-at'),
      );
      return { shown, expected: bg.startedAt + 30000 };
    });
    expect(Math.abs(times.shown - times.expected)).toBeLessThanOrEqual(1000);
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitemcheckbox', { name: 'Repeat all', exact: true }).click();
    await expect(panel.getByTestId('playlist-ends-at')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
