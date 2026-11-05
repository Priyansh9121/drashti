import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  relaunchApp,
} from './helpers';
import { makeTestImage } from './test-media';

/*
 * Deleted things stay gone after a restart (alpha.15, the owner's bug in alpha.14: "deleted things come back after a
 * restart"). Everything is deleted as an operator deletes it, with its Undo notice up, and Drashti quits straight
 * after. What came back: a smart playlist's files the operator had deleted, imported again when their files changed
 * while Drashti was closed (a cloud folder fetching them again does that), and Simple Mode's playlist for the day,
 * made again under the very name of the one deleted. Placeholder files only, made here.
 */

/** Smart playlists look every second and take a file once it has held still for half a second. */
const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };

/** The system's file dialog answers with these (as a person choosing them would). */
async function dialogPicks(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: chosen });
  }, paths);
}

/** The library's presentations and media, by name, and each playlist's rows ("(removed)": its presentation is). */
const library = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const playlists: Record<string, string[]> = {};
    for (const n of await d.playlists.tree())
      if (!n.isFolder)
        playlists[n.name] = (await d.playlists.items(n.id)).map((i) =>
          i.kind === 'header'
            ? `# ${i.label}`
            : i.kind === 'presentation' && i.presentationName === null
              ? `${i.label} (removed)`
              : i.label,
        );
    return {
      presentations: (await d.library.listPresentations()).map((p) => p.name).sort(),
      media: (await d.library.listMedia()).map((m) => m.name).sort(),
      playlists,
    };
  });

/** Delete a presentation or a media file from the library's sheet: its trash, and Delete when it asks. */
async function deleteFromLibrary(win: Page, tab: 'presentations' | 'media', name: string): Promise<void> {
  const sheet = await openLibrary(win);
  await sheet.getByTestId(`library-tab-${tab}`).click();
  const row = sheet
    .getByTestId(tab === 'media' ? 'media-item' : 'presentation-row')
    .filter({ hasText: name });
  await row.click();
  await win.getByRole('button', { name: `Delete “${name}”`, exact: true }).click();
  // Asked first only when it is in a playlist (Session 55, Part 14); otherwise deleted at once.
  const asked = win.getByTestId(tab === 'media' ? 'media-remove-confirm' : 'remove-confirm');
  await expect.poll(async () => (await asked.count()) > 0 || (await row.count()) === 0).toBe(true);
  if ((await asked.count()) > 0) await asked.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
  await expect(win.getByTestId('undo-removal')).toContainText(`Deleted “${name}”`);
}

/** Delete a playlist with its row's trash, as the operator does. */
async function deletePlaylist(win: Page, name: string): Promise<void> {
  await closeLibrary(win);
  const panel = win.getByTestId('playlists');
  const id = await win.evaluate(
    async (n) =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).find((t) => t.name === n)?.id ?? '',
    name,
  );
  const node = panel.locator(`[data-testid="playlist-node"][data-node-id="${id}"]`);
  await node.click({ button: 'right' });
  await win.keyboard.press('Escape');
  await panel.getByRole('button', { name: `Delete playlist “${name}”` }).click();
  await win.getByTestId('remove-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(node).toHaveCount(0);
  await expect(win.getByTestId('undo-removal')).toContainText(`Deleted playlist “${name}”`);
}

test('what the operator deleted stays gone after a restart: presentations made here and imported, a picture, a folder’s files and its playlist, and a smart playlist’s files, even when its folder’s files change while Drashti is closed', async () => {
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-delete-restart-'));
  const { app, userData } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  const words = join(work, 'Placeholder Imported Words.txt');
  writeFileSync(words, 'Placeholder imported line\n');
  const picture = await makeTestImage(win, join(work, 'Placeholder Picture.png'), { color: '#1e3a8a' });
  // A folder for Import… › A Folder…, and another a smart playlist follows (+ New › Smart Playlist from a Folder…).
  const folder = join(work, 'Placeholder Folder');
  mkdirSync(join(folder, 'Week 1'), { recursive: true });
  await makeTestImage(win, join(folder, 'Folder Cover.png'), { color: '#7c2d12' });
  writeFileSync(join(folder, 'Week 1', 'Folder Words.txt'), 'Placeholder folder line\n');
  const smart = join(work, 'Placeholder Smart');
  mkdirSync(join(smart, 'Week 1'), { recursive: true });
  const smartFiles = [
    await makeTestImage(win, join(smart, 'Smart Cover.png'), { color: '#365314' }),
    await makeTestImage(win, join(smart, 'Smart Darshan.png'), { color: '#581c87' }),
    join(smart, 'Week 1', 'Smart Handout.pdf'),
  ];
  writeFileSync(
    smartFiles[2] ?? '',
    makeTestPdf([{ width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder handout' }]),
  );
  // Put in the smart playlist's folder while Drashti is closed.
  const newPicture = await makeTestImage(win, join(work, 'Smart New.png'), { color: '#9a3412' });

  // Made here (New… from words), imported (Import… › Files…), and a folder (Import… › A Folder…) into its own playlist.
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder Made Here',
      'Placeholder made line\n',
    );
    if (!made.ok) throw new Error(made.message);
  });
  const report = win.getByTestId('import-report');
  await dialogPicks(app, [words, picture]);
  await (await openLibrary(win)).getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'Files…' }).click();
  await expect(report).toBeVisible({ timeout: 60_000 });
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  await dialogPicks(app, [folder]);
  await (await openLibrary(win)).getByRole('button', { name: 'Import…' }).click();
  await win.getByRole('menuitem', { name: 'A Folder…' }).click();
  await expect(report).toBeVisible({ timeout: 60_000 });
  await expect(report.getByTestId('report-add-target')).toHaveValue('new');
  await report.getByTestId('report-add-button').click();
  await expect(report.getByTestId('report-added')).toContainText('Added to “Placeholder Folder”');
  await report.getByRole('button', { name: 'Close', exact: true }).first().click();
  // The smart playlist, filled by itself.
  await closeLibrary(win);
  await dialogPicks(app, [smart]);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  await expect
    .poll(async () => (await library(win)).playlists['Placeholder Smart'], { timeout: 60_000 })
    .toEqual(['Smart Cover.png', 'Smart Darshan.png', '# Week 1', 'Smart Handout']);
  expect((await library(win)).playlists['Placeholder Folder']).toEqual([
    'Folder Cover.png',
    '# Week 1',
    'Folder Words',
  ]);

  // Deleted as the operator deletes them, each with its Undo notice.
  for (const name of ['Placeholder Made Here', 'Placeholder Imported Words', 'Folder Words', 'Smart Handout'])
    await deleteFromLibrary(win, 'presentations', name);
  for (const name of ['Placeholder Picture.png', 'Folder Cover.png', 'Smart Cover.png'])
    await deleteFromLibrary(win, 'media', name);
  await deletePlaylist(win, 'Placeholder Folder');
  // A smart playlist's row taken out of it (Remove from playlist), its file staying in the library.
  await closeLibrary(win);
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Smart' }).click();
  const darshan = win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .filter({ hasText: 'Smart Darshan' });
  await darshan.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Remove from playlist' }).click();
  await expect(darshan).toHaveCount(0);
  const deleted = await library(win);
  expect(deleted).toEqual({
    presentations: ['Language test slides', 'Sample kirtan (placeholder)'],
    media: ['Smart Darshan.png'],
    playlists: { 'Placeholder Smart': ['# Week 1', 'Smart Handout (removed)'] },
  });
  // Quit straight after, the Undo notice still up.
  await app.close();

  // While Drashti is closed, the smart playlist's folder changes: every file there fetched again (new times, as a
  // cloud folder gives them), and a new one, which must still join.
  const later = new Date(Date.now() + 120_000);
  for (const file of smartFiles) utimesSync(file, later, later);
  renameSync(newPicture, join(smart, 'Smart New.png'));
  const again = await relaunchApp(userData, QUICK);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  // The new file joining says the smart playlist has looked at its folder since the start, and taken what it would.
  await expect
    .poll(async () => (await library(win2)).playlists['Placeholder Smart'], { timeout: 60_000 })
    .toContain('Smart New.png');
  const after = await library(win2);
  expect(after.presentations).toEqual(deleted.presentations);
  expect(after.media).toEqual(['Smart Darshan.png', 'Smart New.png']);
  expect(after.playlists).toEqual({
    'Placeholder Smart': ['Smart New.png', '# Week 1', 'Smart Handout (removed)'],
  });
  await again.app.close();
});

test('Simple Mode’s playlist deleted in Pro Mode does not come back under its name: Simple Mode next makes a new one, named apart', async () => {
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-delete-simple-'));
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  // Simple Mode with nothing open makes its playlist for the day, and a picture goes into it (Add files…).
  await chooseMenuItem(app, 'switch-mode');
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  const day = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const one = await d.app.simplePlaylist();
    return (await d.playlists.tree()).find((n) => n.id === one)?.name ?? '';
  });
  expect(day).toMatch(/^Sabha, \d{1,2} \w{3} \d{4}$/u);
  await dialogPicks(app, [
    await makeTestImage(win, join(work, 'Placeholder Day Picture.png'), { color: '#14532d' }),
  ]);
  await simple.getByTestId('column-middle').getByTestId('playlist-add-files').click();
  await expect(simple.getByTestId('playlist-item')).toHaveCount(1);
  // Back in Pro Mode, the day's playlist deleted; Drashti quits straight after.
  await chooseMenuItem(app, 'switch-mode');
  await expect(simple).toHaveCount(0);
  await deletePlaylist(win, day);
  await app.close();

  const again = await relaunchApp(userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  expect(Object.keys((await library(win2)).playlists)).not.toContain(day);
  // Simple Mode again: a new, empty playlist, never one named as the deleted one was.
  await chooseMenuItem(again.app, 'switch-mode');
  const simple2 = win2.getByTestId('simple-mode');
  await expect(simple2).toBeVisible();
  await expect(simple2.getByTestId('column-middle').getByTestId('playlist-title')).toHaveText(`${day} (2)`);
  await expect(simple2.getByTestId('playlist-item')).toHaveCount(0);
  expect((await library(win2)).playlists).toEqual({ [`${day} (2)`]: [] });
  await again.app.close();
});
