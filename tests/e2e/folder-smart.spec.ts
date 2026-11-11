import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dropPaths } from './folder-drop';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';
import { sizeOperatorWindow } from './window-size';

/*
 * A folder dropped on Drashti (Session 56, the owner's words of 11 Nov 2026, item 5): "A folder dragged in is added
 * straight away, with no questions (no "add to playlist"): it becomes a smart playlist that follows that folder. Same in
 * Simple Mode." Dropped on the open playlist, a playlist's row in the list, or anywhere on the window, it becomes at
 * once a new smart playlist named after it, opened in the middle, with no import report and no question; it fills
 * itself as its files hold still. Files dropped still go where they went. Temporary folders of generated pictures and
 * tones only; the test switches make Drashti look every second and wait half a second for a file to hold still.
 */

const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };

/** A playlist's or folder's row in the list on the left, by its own name. */
const node = (win: Page, name: string): Locator =>
  win.getByTestId('playlist-node').filter({ has: win.getByText(name, { exact: true }) });

/** A playlist's whole order as it is kept: "# Header" or the row's name. */
const itemsOf = (win: Page, playlistId: string) =>
  win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) =>
        i.kind === 'header' ? `# ${i.label}` : i.label,
      ),
    playlistId,
  );

/** The id of the playlist of this name (null: none). */
const playlistNamed = (win: Page, name: string) =>
  win.evaluate(
    async (wanted) =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).find((n) => n.name === wanted) ?? null,
    name,
  );

/** A folder of a generated picture, and a tone in a folder of its own inside it. */
async function placeholderFolder(win: Page, name: string, color: string): Promise<string> {
  const folder = join(mkdtempSync(join(tmpdir(), 'drashti-folder-smart-')), name);
  mkdirSync(join(folder, 'Talks'), { recursive: true });
  await makeTestImage(win, join(folder, `${name} picture.png`), { color });
  makeTestTone(join(folder, 'Talks', `${name} talk.wav`), { seconds: 1, hz: 330 });
  return folder;
}

/** It was made at once, named after its folder, a smart playlist, and opened in the middle, with nothing asked. */
async function madeAndOpened(win: Page, name: string): Promise<string> {
  await expect(node(win, name)).toHaveAttribute('data-playlist-kind', 'smart');
  await expect(win.getByTestId('column-middle').getByTestId('playlist-title')).toHaveText(name);
  await expect(win.getByTestId('smart-bar')).toBeVisible();
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(win.getByTestId('report-add')).toHaveCount(0);
  const made = await playlistNamed(win, name);
  expect(made?.kind).toBe('smart');
  // It fills itself as its files hold still: the picture, then the talk under its folder's header.
  await expect
    .poll(() => itemsOf(win, made?.id ?? ''), { timeout: 30_000 })
    .toEqual([`${name} picture.png`, '# Talks', `${name} talk.wav`]);
  return made?.id ?? '';
}

test('Pro Mode: a folder dropped on the open playlist, a playlist’s row or anywhere becomes a smart playlist following it at once, opened in the middle, nothing asked; a file dropped with it goes into the open playlist as before', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  const show = await setUpPlaceholderShow(win);
  const before = await itemsOf(win, show.playlistId);
  await node(win, PLAYLIST).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);

  // On the open playlist: a folder, and a picture with it.
  const week = await placeholderFolder(win, 'Placeholder Week', '#365314');
  const loose = await makeTestImage(
    win,
    join(mkdtempSync(join(tmpdir(), 'drashti-loose-')), 'Placeholder loose.png'),
  );
  await dropPaths(win, win.getByTestId('open-playlist'), [week, loose]);
  await madeAndOpened(win, 'Placeholder Week');
  // The picture went into the playlist open when it was dropped, at its end, as files dropped there always did.
  await expect.poll(() => itemsOf(win, show.playlistId)).toEqual([...before, 'Placeholder loose.png']);

  // Anywhere else on the window (the live column).
  const festival = await placeholderFolder(win, 'Placeholder Festival', '#1e3a8a');
  await dropPaths(win, win.getByTestId('column-right'), [festival]);
  await madeAndOpened(win, 'Placeholder Festival');

  // On another playlist's row in the list: a smart playlist of its own, never into that playlist.
  const youth = await placeholderFolder(win, 'Placeholder Youth', '#7c2d12');
  await dropPaths(win, node(win, PLAYLIST), [youth]);
  await madeAndOpened(win, 'Placeholder Youth');
  expect(await itemsOf(win, show.playlistId)).toEqual([...before, 'Placeholder loose.png']);
  await app.close();
});

test('Simple Mode: a folder dropped becomes a smart playlist following it at once, opened in the middle, nothing asked', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  const day = await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist());
  await expect(simple.getByTestId('playlist-title')).toHaveText(/^Sabha, /u);

  // On its open playlist.
  const week = await placeholderFolder(win, 'Placeholder Simple Week', '#365314');
  await dropPaths(win, simple.getByTestId('open-playlist'), [week]);
  const made = await madeAndOpened(win, 'Placeholder Simple Week');
  // Simple Mode's playlist is the one open now (a phone works on it); the day's is left as it was.
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(made);
  expect(await itemsOf(win, day ?? '')).toEqual([]);

  // Anywhere else on the window (the live column).
  const later = await placeholderFolder(win, 'Placeholder Simple Later', '#1e3a8a');
  await dropPaths(win, simple.getByTestId('column-right'), [later]);
  await madeAndOpened(win, 'Placeholder Simple Later');
  await expect(win.getByText('Simple Mode is on', { exact: false })).toHaveCount(0);
  await app.close();
});
