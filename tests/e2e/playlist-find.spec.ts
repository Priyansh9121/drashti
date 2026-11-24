import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, openSection, operatorPage, operatorReady } from './helpers';
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
        await d.media.rename(sound, 'Placeholder renamed track.wav');
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
    const chosenIds = () =>
      panel
        .locator('[data-marked="true"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-item-id')));
    const chosen = await chosenIds();
    await panel.getByRole('button', { name: 'Find in playlist', exact: true }).click();
    const find = panel.getByRole('textbox', { name: 'Find in playlist', exact: true });
    await find.fill('Needle');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('1 of 3');
    await find.press('Enter');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('2 of 3');
    await expect(panel.locator('[data-found="true"]')).toContainText('37');
    await find.press('Shift+Enter');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('1 of 3');
    expect(await chosenIds()).toEqual(chosen);
    const after = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    expect(after.rev).toBe(before.rev);
    expect(after.state.live).toEqual(before.state.live);
    expect(after.state.layers).toEqual(before.state.layers);
    await expectNoSeriousA11yIssues(win, 'playlist Find');
    await find.press('Escape');
    await expect(find).toHaveCount(0);
    await openSection(win, 'audio');
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

test('Find reads a folded presentation’s words beyond its first line without putting it up', async () => {
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const doc = await d.library.newFromWords(
        'Placeholder words',
        'Placeholder first line\nPlaceholder deeper match',
      );
      const list = await d.playlists.create('Placeholder word find', null, false);
      if (!doc.ok || !list.ok) throw new Error('Could not make the placeholder words');
      await d.playlists.addItems(list.ids[0] ?? '', null, [{ kind: 'presentation', presentationId: doc.id }]);
    });
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder word find' }).click();
    const panel = win.getByTestId('open-playlist');
    await expect(panel.getByTestId('slide-thumb')).toHaveCount(1);
    await panel.getByTestId('playlist-item').click();
    await expect(panel.getByTestId('slide-thumb')).toHaveCount(0);
    const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    await panel.getByRole('button', { name: 'Find in playlist', exact: true }).click();
    await panel.getByRole('textbox', { name: 'Find in playlist', exact: true }).fill('deeper match');
    await expect(panel.getByTestId('playlist-find-count')).toHaveText('1 of 1');
    await expect(panel.getByTestId('slide-thumb')).toHaveAttribute('data-found', 'true');
    const after = await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
    expect(after.state.layers).toEqual(before.state.layers);
    expect(after.state.live).toEqual(before.state.live);
  } finally {
    await app.close();
  }
});
