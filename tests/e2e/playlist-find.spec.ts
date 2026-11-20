import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestImage, makeTestTone } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

test('Find in 60 rows moves and marks matches without choosing a row or changing the live show; Music does the same', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-find-'));
    const image = await makeTestImage(win, join(dir, 'Placeholder still.png'));
    const tone = makeTestTone(join(dir, 'Placeholder Needle tone.wav'), { seconds: 30, hz: 440 });
    const [picture = '', sound = ''] = await importAndGetIds(win, [image, tone]);
    await win.evaluate(
      async ({ picture, sound }) => {
        const d = (globalThis as PageGlobals).drashti;
        const list = await d.playlists.create('Placeholder find', null, false);
        if (!list.ok) throw new Error(list.message);
        await d.playlists.addItems(list.ids[0] ?? '', null, [
          { kind: 'media', mediaId: picture },
          ...Array.from({ length: 59 }, (_, i) => ({
            kind: 'header' as const,
            label: [13, 37, 58].includes(i)
              ? `Placeholder Needle ${String(i)}`
              : `Placeholder row ${String(i)}`,
          })),
        ]);
        const music = await d.music.create('Placeholder music find');
        if (!music.ok || !music.id) throw new Error('No audio playlist');
        await d.music.addTracks(music.id, [sound, sound, sound], null);
      },
      { picture, sound },
    );
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder find' }).click();
    const panel = win.getByTestId('open-playlist');
    await expect(panel.getByTestId('playlist-item')).toHaveCount(60);
    await panel.getByTestId('playlist-item').first().click();
    const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    const chosen = await panel.locator('[data-marked="true"]').count();
    await panel.getByRole('button', { name: 'Find in playlist', exact: true }).click();
    const find = panel.getByRole('textbox', { name: 'Find in playlist', exact: true });
    await find.fill('Needle');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('1 of 3');
    await find.press('Enter');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('2 of 3');
    await expect(panel.locator('[data-found="true"]')).toContainText('37');
    await find.press('Shift+Enter');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('1 of 3');
    expect(await panel.locator('[data-marked="true"]').count()).toBe(chosen);
    const after = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    expect(after.rev).toBe(before.rev);
    expect(after.state.live).toEqual(before.state.live);
    expect(after.state.layers).toEqual(before.state.layers);
    await expectNoSeriousA11yIssues(win, 'playlist Find');
    await find.press('Escape');
    await expect(find).toHaveCount(0);
    const music = win.getByTestId('music-panel');
    await music.getByRole('button', { name: 'Find in audio playlist', exact: true }).click();
    const trackFind = music.getByRole('textbox', { name: 'Find in audio playlist', exact: true });
    await trackFind.fill('Needle');
    await expect(music.getByTestId('music-find-count')).toHaveText('1 of 3');
    await trackFind.press('Enter');
    await expect(music.getByTestId('music-find-count')).toHaveText('2 of 3');
    expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).rev).toBe(
      before.rev,
    );
    await expectNoSeriousA11yIssues(win, 'audio playlist Find');
  } finally {
    await app.close();
  }
});
