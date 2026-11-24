import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them"), in
 * the open playlist's ⋯ Playlist actions (Pro Mode's): Copy running order puts plain lines on the clipboard, written by
 * the main process. Placeholder names and generated media only.
 */

/** 'Placeholder sabha <test>': a header, the library's first presentation and a 10-second video, opened. */
async function placeholderSabha(win: Page, dir: string): Promise<{ id: string; labels: string[] }> {
  const video = await makeTestVideo(win, join(dir, 'Placeholder video.webm'), { seconds: 10 });
  const [mediaId] = await importAndGetIds(win, [video]);
  const made = await win.evaluate(async (media) => {
    const d = (globalThis as PageGlobals).drashti;
    const first = (await d.library.listPresentations())[0];
    if (!first) throw new Error('No presentation to add');
    const list = await d.playlists.create('Placeholder sabha <test>', null, false);
    if (!list.ok) throw new Error(list.message);
    const id = list.ids[0] ?? '';
    const added = await d.playlists.addItems(id, null, [
      { kind: 'header', label: 'Placeholder Dhun' },
      { kind: 'presentation', presentationId: first.id },
      { kind: 'media', mediaId: media },
    ]);
    if (!added.ok) throw new Error(added.message);
    return { id, labels: (await d.playlists.items(id)).map((i) => i.label) };
  }, mediaId ?? '');
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder sabha' }).click();
  // The video's length is known (the running order says it).
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-totals')).toHaveText(
    '3 rows · videos and sounds 0:10',
  );
  return made;
}

const clipboardText = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

test('Copy running order puts the open playlist’s plain lines on the clipboard; Simple Mode copies nothing', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-running-order-'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const { id, labels } = await placeholderSabha(win, dir);
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Placeholder clipboard');
    });
    await win.getByRole('button', { name: 'Playlist actions' }).click();
    await win.getByRole('menuitem', { name: 'Copy running order', exact: true }).click();
    await expect(win.getByTestId('operator-notice')).toContainText(
      'Copied the running order (2 rows): paste it where you need it.',
    );
    expect((await clipboardText(app)).split('\n')).toEqual([
      'Placeholder sabha <test>',
      '— Placeholder Dhun —',
      `1. ${labels[1] ?? ''}`,
      `2. ${labels[2] ?? ''}, 0:10`,
      'Videos and sounds in all: 0:10',
    ]);

    // Simple Mode: no ⋯ of the playlist's own, and the main process copies nothing when asked.
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText('Placeholder clipboard');
    });
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Playlist actions' })).toHaveCount(0);
    const refused = await win.evaluate(
      (playlistId) => (globalThis as PageGlobals).drashti.playlists.copyRunningOrder(playlistId),
      id,
    );
    expect(refused).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(await clipboardText(app)).toBe('Placeholder clipboard');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
