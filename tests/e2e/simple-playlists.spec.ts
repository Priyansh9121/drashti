import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage, makeTestTone } from './test-media';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Simple Mode's playlists (Session 56, the owner's words of 11 Nov 2026, item 14): "Several playlists on the left, with
 * folders, as in Pro Mode, and smart playlists", Pro Mode's own playlists panel let through Simple Mode's bounds in the
 * main process. A volunteer makes, renames, deletes and puts back a playlist and a folder, makes a playlist in a
 * folder and a smart playlist, and opens each in the middle; each kind says in a line what it is (item 4). What is Pro
 * Mode's stays out (templates, sharing, Practise, Duplicate, Repeat Slides made), and a paired phone still changes no
 * playlist. Generated pictures and tones and placeholder names only.
 */

const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };

/** A playlist's or folder's row in the list on the left, by its own name. */
const node = (win: Page, name: string): Locator =>
  win.getByTestId('playlist-node').filter({ has: win.getByText(name, { exact: true }) });

/** The playlist of this name (null: none), as the main process keeps it. */
const playlistNamed = (win: Page, name: string) =>
  win.evaluate(
    async (wanted) =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).find((n) => n.name === wanted) ?? null,
    name,
  );

/** The system's file dialog answers with these (as a person choosing them would). */
async function dialogPicks(app: ElectronApplication, files: string[]): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: chosen });
  }, files);
}

/** Type a name into the field that opened for it, and keep it. */
async function nameIt(win: Page, name: string): Promise<void> {
  const field = win.getByTestId('rename-field');
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press('Enter');
  await expect(field).toHaveCount(0);
}

/** Its right-click menu's entries' names. */
async function menuOf(win: Page, row: Locator): Promise<string[]> {
  await row.click({ button: 'right' });
  const names = await win
    .getByRole('menu')
    .getByRole('menuitem')
    .evaluateAll((items) => items.map((i) => i.getAttribute('aria-label') ?? i.textContent.trim()));
  await win.keyboard.press('Escape');
  return names;
}

const undo = (win: Page) => win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();

async function intoSimple(win: Page): Promise<Locator> {
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  return simple;
}

test('Simple Mode has Pro Mode’s playlists on the left: a playlist and a folder made, renamed, deleted and put back, a playlist in a folder and a smart playlist made, each opened in the middle; each kind says what it is; nothing Pro Mode’s', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await node(win, PLAYLIST).click();
  const simple = await intoSimple(win);
  const left = simple.getByTestId('column-left');
  const middle = simple.getByTestId('column-middle');
  const title = middle.getByTestId('playlist-title');

  // As it comes: the playlist open in Pro Mode, in the middle and marked open on the left, the wallpapers under the
  // playlists, Undo at the foot.
  await expect(title).toHaveText(PLAYLIST);
  await expect(left.getByTestId('playlist-tree')).toBeVisible();
  await expect(node(win, PLAYLIST)).toHaveAttribute('data-open', 'true');
  await expect(left.getByTestId('wallpapers')).toBeVisible();
  // No library, no templates, no AI playlist.
  await expect(win.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0);
  await expect(win.getByTestId('playlist-view-tab-templates')).toHaveCount(0);

  // + New: a playlist, a folder and a smart playlist, each with a line saying what it is (item 4); Repeat Slides is
  // Pro Mode's.
  await left.getByRole('button', { name: 'New playlist or folder' }).click();
  const menu = win.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
  await expect(menu.getByRole('menuitem', { name: 'New playlist', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'New folder', exact: true })).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Smart Playlist from a Folder…', exact: true }),
  ).toBeVisible();
  await expect(menu.getByTestId('menu-note')).toHaveText([
    'The running order: Next puts its rows up one after another.',
    'Holds playlists, to keep them together.',
    'Follows a folder on this computer: what goes in it joins by itself.',
  ]);

  // A folder, named at once; empty and open, it says what a folder is for.
  await menu.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  await nameIt(win, 'Placeholder Youth');
  await expect(node(win, 'Placeholder Youth')).toHaveAttribute('data-kind', 'folder');
  await expect(left.getByTestId('folder-empty')).toContainText('A folder holds playlists');

  // A playlist in it (its right-click's New playlist here), named at once; a click opens it in the middle.
  expect(await menuOf(win, node(win, 'Placeholder Youth'))).toEqual([
    'New playlist here',
    'New folder here',
    'Rename…',
    'Delete…',
  ]);
  await node(win, 'Placeholder Youth').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'New playlist here' }).click();
  await nameIt(win, 'Placeholder Youth evening');
  await node(win, 'Placeholder Youth evening').click();
  await expect(title).toHaveText('Placeholder Youth evening');
  const evening = await playlistNamed(win, 'Placeholder Youth evening');
  const folder = await playlistNamed(win, 'Placeholder Youth');
  expect(evening?.parentId).toBe(folder?.id);
  // The window opened it: it is Simple Mode's playlist now (a phone's too).
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBe(
    evening?.id,
  );

  // Its rows, as in any playlist: Add files… brings a picture in.
  const dir = mkdtempSync(join(tmpdir(), 'drashti-simple-playlists-'));
  const picture = await makeTestImage(win, join(dir, 'Placeholder youth picture.png'), { color: '#4c1d95' });
  await dialogPicks(app, [picture]);
  await middle.getByTestId('playlist-add-files').click();
  await expect(middle.getByTestId('playlist-item')).toHaveCount(1);

  // A playlist's menu: Open, Rename… and Delete… only (sharing, Practise and Duplicate are Pro Mode's).
  expect(await menuOf(win, node(win, 'Placeholder Youth evening'))).toEqual(['Open', 'Rename…', 'Delete…']);
  // Renamed from its menu: the middle's name follows.
  await node(win, 'Placeholder Youth evening').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Rename…' }).click();
  await nameIt(win, 'Placeholder Youth night');
  await expect(title).toHaveText('Placeholder Youth night');

  // Deleted while open: the middle closes it; Undo puts it back, open again.
  await node(win, 'Placeholder Youth night').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(node(win, 'Placeholder Youth night')).toHaveCount(0);
  await expect(middle.getByTestId('no-playlist-open')).toBeVisible();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.simplePlaylist())).toBeNull();
  await undo(win);
  await expect(title).toHaveText('Placeholder Youth night');
  await expect(middle.getByTestId('playlist-item')).toHaveCount(1);

  // The folder renamed from its menu, then deleted with the playlist in it, and put back.
  await node(win, 'Placeholder Youth').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Rename…' }).click();
  await nameIt(win, 'Placeholder Youth group');
  await expect(node(win, 'Placeholder Youth group')).toHaveAttribute('data-kind', 'folder');
  await node(win, 'Placeholder Youth group').click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Delete…' }).click();
  await expect(win.getByTestId('remove-confirm')).toContainText('The playlist in it goes too.');
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(node(win, 'Placeholder Youth group')).toHaveCount(0);
  await expect(node(win, 'Placeholder Youth night')).toHaveCount(0);
  await expect(middle.getByTestId('no-playlist-open')).toBeVisible();
  await undo(win);
  await expect(node(win, 'Placeholder Youth group')).toBeVisible();
  await expect(node(win, 'Placeholder Youth night')).toBeVisible();
  await expect(title).toHaveText('Placeholder Youth night');

  // A smart playlist from a folder chosen in the system's dialog: made, opened, filling itself.
  const followed = join(dir, 'Placeholder Simple Smart');
  mkdirSync(followed);
  await makeTestImage(win, join(followed, 'Placeholder smart picture.png'), { color: '#365314' });
  makeTestTone(join(followed, 'Placeholder smart tone.wav'), { seconds: 1, hz: 392 });
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, followed);
  await left.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…', exact: true }).click();
  await expect(title).toHaveText('Placeholder Simple Smart');
  await expect(node(win, 'Placeholder Simple Smart')).toHaveAttribute('data-playlist-kind', 'smart');
  await expect(middle.getByTestId('smart-bar')).toContainText('A smart playlist, following');
  await expect(middle.getByTestId('playlist-item')).toHaveCount(2, { timeout: 30_000 });

  // Back to the first, with a click.
  await node(win, PLAYLIST).click();
  await expect(title).toHaveText(PLAYLIST);
  // It fits CI's window and passes the accessibility checks, the playlists and the wallpapers both in the column.
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await expectFits(simple, 'Simple Mode with its playlists at 1024 × 645');
  await expect(left.getByTestId('playlist-tree')).toBeVisible();
  await expect(left.getByTestId('wallpapers')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Simple Mode with its playlists at 1024 × 645');
  await app.close();
});

test('a phone in Simple Mode still changes no playlist, and follows the one Simple Mode’s window opens', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder phone');
  await node(win, PLAYLIST).click();
  const simple = await intoSimple(win);
  const other = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.playlists.create('Placeholder other', null, false);
    if (!made.ok) throw new Error(made.message);
    return made.ids[0] ?? '';
  });
  const hall = async () =>
    ((await apiCall(port, '/api/v1/hall', { token })).json['simple'] as { playlistId?: string } | null)
      ?.playlistId ?? null;
  await expect.poll(hall).toBe(show.playlistId);

  // Making, renaming, deleting a playlist and changing its rows, as a phone or a script asks: refused, nothing changed.
  const before = await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree());
  const refused = { ok: false, message: SIMPLE_MODE_REFUSAL };
  for (const [path, body] of [
    ['/api/v1/playlists/new', { name: 'Placeholder from a phone' }],
    [`/api/v1/playlists/${other}/rename`, { name: 'Placeholder renamed' }],
    ['/api/v1/playlists/delete', { ids: [other] }],
    ['/api/v1/playlists/restore', { ids: [other] }],
    [`/api/v1/playlists/${other}/add`, { items: [{ kind: 'media', mediaId: show.pictureMediaId }] }],
  ] as const) {
    const r = await apiCall(port, path, { method: 'POST', token, body });
    expect(r.status, path).toBe(403);
    expect(r.json, path).toMatchObject(refused);
  }
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.playlists.tree())).toEqual(before);

  // The window opens another: the phone's playlist follows it.
  await node(win, 'Placeholder other').click();
  await expect(simple.getByTestId('playlist-title')).toHaveText('Placeholder other');
  await expect.poll(hall).toBe(other);
  await app.close();
});
