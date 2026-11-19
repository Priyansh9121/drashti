import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  closePlaylistIfOpen,
  dropFiles,
  holdStill,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { mouseDrag } from './mouse-drag';
import { makeTestImage, makeTestVideo } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Files dropped where no playlist is open (Session 60, x36; the owner, 19 Nov 2026: "when dragging a video in the empty
 * screen, it should create a new playlist/folder which should be prompted, a small window -> create a folder or
 * playlist and then the video is saved in that particular playlist or folder"; his answers to D1-D4, "Yes, all A"):
 * a small window asks where they go, a new playlist (chosen to begin with) or a new folder, named there; a new folder
 * holds a new playlist named after the first file. Whatever a playlist takes, one file or several, in the order
 * dragged, anywhere on the window while no playlist is open, and Media's rows dragged from the library; Create (Enter)
 * makes it and opens the playlist, Cancel (Esc) brings nothing in. The same window in Simple Mode. Drops onto an open
 * playlist go into it, nothing asked, as before. Generated media and placeholder names only, at CI's window size.
 */

const dialogOf = (win: Page) => win.getByTestId('drop-new-dialog');

/** The playlists and folders, as "name (playlist|folder)", in the tree's order. */
const tree = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.playlists.tree()).map(
      (n) => `${n.name} (${n.isFolder ? 'folder' : 'playlist'})${n.parentId ? ' in a folder' : ''}`,
    ),
  );

/** The open playlist's rows' names, in order. */
const rowsOpen = (win: Page) => win.getByTestId('open-playlist').getByTestId('playlist-item');

/** The library's media names. */
const mediaNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listMedia()).map((m) => m.name).sort(),
  );

/** The window, asking about these files: a new playlist chosen, named after the first file, its name to type. */
async function asked(win: Page, title: RegExp, name: string): Promise<Locator> {
  const dialog = dialogOf(win);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText(title);
  await expect(dialog.getByRole('radio', { name: 'A new playlist' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'A new folder' })).not.toBeChecked();
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toHaveValue(name);
  await expect(field).toBeFocused();
  return dialog;
}

test('files dropped with no playlist open: a small window makes a new playlist or a new folder for them, named there; Enter makes it and opens it, Esc brings nothing in; Media’s rows too; an open playlist takes a drop as before', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-drop-new-'));
  const clip = await makeTestVideo(win, join(dir, 'Placeholder clip.webm'), { seconds: 2, hue: 30 });
  const picture = await makeTestImage(win, join(dir, 'Placeholder picture.png'), { color: '#14532d' });
  const second = await makeTestVideo(win, join(dir, 'Placeholder second.webm'), { seconds: 2, hue: 200 });
  const kept = await makeTestVideo(win, join(dir, 'Placeholder not kept.webm'), { seconds: 2, hue: 300 });
  const later = await makeTestVideo(win, join(dir, 'Placeholder later.webm'), { seconds: 2, hue: 100 });
  expect(await tree(win)).toEqual([]);

  // One video dropped on the empty middle: the window, a new playlist named after it; Enter makes it and opens it.
  const middle = win.getByTestId('start-here');
  await expect(middle).toBeVisible();
  await dropFiles(win, middle, [clip], { overlay: false });
  const dialog = await asked(win, /Placeholder clip\.webm/u, 'Placeholder clip');
  await expectFits(dialog, 'the drop window in CI’s window');
  await expectNoSeriousA11yIssues(win, 'the drop window', '[data-testid="drop-new-dialog"]');
  await win.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => tree(win)).toEqual(['Placeholder clip (playlist)']);
  await expect(win.getByTestId('playlist-node').filter({ hasText: 'Placeholder clip' })).toHaveAttribute(
    'data-open',
    'true',
  );
  await expect(rowsOpen(win)).toHaveText([/Placeholder clip/u]);

  // Two files on the playlists column, outside a playlist's name: A new folder, named; it holds a new playlist named
  // after the first file, the two in the order dragged.
  await closePlaylistIfOpen(win);
  await dropFiles(win, win.getByTestId('playlist-tree'), [picture, second], { overlay: false, at: 'bottom' });
  await asked(win, /2 files/u, 'Placeholder picture');
  await dialog.getByRole('radio', { name: 'A new folder' }).check();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Placeholder folder');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => tree(win))
    .toEqual([
      'Placeholder clip (playlist)',
      'Placeholder folder (folder)',
      'Placeholder picture (playlist) in a folder',
    ]);
  await expect(rowsOpen(win)).toHaveText([/Placeholder picture/u, /Placeholder second/u]);

  // Esc (and Cancel): nothing comes in, nothing is made. On LIVE this time.
  await closePlaylistIfOpen(win);
  const before = await mediaNames(win);
  await dropFiles(win, win.getByTestId('live-preview'), [kept], { overlay: false });
  await asked(win, /Placeholder not kept\.webm/u, 'Placeholder not kept');
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await holdStill(
    async () => JSON.stringify(await mediaNames(win)) === JSON.stringify(before),
    2000,
    'nothing was imported after Cancel',
  );
  expect(await tree(win)).toHaveLength(3);

  // A Media row dragged from the library onto the empty middle: the same window, the row in the new playlist.
  const [stillId = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder still.png'), { color: '#7c2d12' }),
  ]);
  expect(stillId).not.toBe('');
  const sheet = await openLibrary(win);
  await sheet.getByTestId('library-tab-media').click();
  await mouseDrag(win, sheet.getByTestId('media-item').filter({ hasText: 'Placeholder still' }), middle);
  await asked(win, /Placeholder still/u, 'Placeholder still');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
  await closeLibrary(win);
  await expect(rowsOpen(win)).toHaveText([/Placeholder still/u]);

  // With a playlist open, a drop goes into it, nothing asked (as before).
  await dropFiles(win, win.getByTestId('open-playlist'), [later], { overlay: false });
  await holdStill(async () => (await dialogOf(win).count()) === 0, 1500, 'no window over an open playlist');
  await expect(rowsOpen(win)).toHaveText([/Placeholder still/u, /Placeholder later/u]);
  await app.close();
});

test('Simple Mode: with no playlist open, files dropped ask the same small window, and the new playlist opens there', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-drop-new-simple-'));
  const clip = await makeTestVideo(win, join(dir, 'Placeholder simple clip.webm'), { seconds: 2, hue: 60 });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // The day's playlist Simple Mode came with, taken away: no playlist open.
  await expect.poll(async () => (await tree(win)).length).toBe(1);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const done = await d.playlists.remove((await d.playlists.tree()).map((n) => n.id));
    if (!done.ok) throw new Error(done.message);
  });
  const none = win.getByTestId('no-playlist-open');
  await expect(none).toBeVisible();

  await dropFiles(win, none, [clip], { overlay: false });
  const dialog = await asked(win, /Placeholder simple clip\.webm/u, 'Placeholder simple clip');
  await expectNoSeriousA11yIssues(win, 'the drop window in Simple Mode', '[data-testid="drop-new-dialog"]');
  await win.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => tree(win)).toEqual(['Placeholder simple clip (playlist)']);
  await expect(rowsOpen(win)).toHaveText([/Placeholder simple clip/u]);
  await app.close();
});
