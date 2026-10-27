import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { mouseDrag } from './mouse-drag';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * A folder playlist a folder at a time (Session 44; Priyansh: "if i open the main folder, its content which is
 * not a folder shows up in middle main, all sub folders in bottom left side. if i click sub folders, their
 * material pops up in middle screen, i can go back to the main folder via clicking the playlist itself"). The
 * playlists have the whole left column; the library opens over it as a sheet from the Library button. Next,
 * Simple Mode and the phones keep the playlist's whole order. Placeholder files only, made here.
 */

const QUICK = { DRASHTI_TEST_SMART_SCAN_MS: '1000', DRASHTI_TEST_SMART_SETTLE_MS: '500' };
const ffmpeg = testFfmpeg();

/** A one-second placeholder video (FFmpeg's test pattern), each size a different file. */
function makeVideo(path: string, size: string): void {
  const r = spawnSync(ffmpeg ?? '', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${size}:r=25`,
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
}

/**
 * A placeholder folder two deep: its own video and picture; "Week 1" with a video and "Videos" inside it;
 * "Week 2" holding only "Pictures". Returns the files in the folder's order.
 */
async function placeholderFolder(win: Page, top: string): Promise<string[]> {
  mkdirSync(join(top, 'Week 1', 'Videos'), { recursive: true });
  mkdirSync(join(top, 'Week 2', 'Pictures'), { recursive: true });
  const files = [
    join(top, 'Opening.mp4'),
    join(top, 'Welcome.png'),
    join(top, 'Week 1', 'Clip.mp4'),
    join(top, 'Week 1', 'Videos', 'Deep.mp4'),
    join(top, 'Week 2', 'Pictures', 'Cover.png'),
  ];
  makeVideo(files[0] ?? '', '320x180');
  await makeTestImage(win, files[1] ?? '', { color: '#14532d' });
  makeVideo(files[2] ?? '', '352x198');
  makeVideo(files[3] ?? '', '384x216');
  await makeTestImage(win, files[4] ?? '', { color: '#1e3a8a' });
  return files;
}

/** The whole playlist, as its items are kept: "# Header" for each header. */
const whole = (win: Page, playlistId: string) =>
  win.evaluate(async (id) => {
    const items = await (globalThis as PageGlobals).drashti.playlists.items(id);
    return items.map((i) => (i.kind === 'header' ? `# ${i.label}` : i.label));
  }, playlistId);

/** The items the middle shows, by name. */
const middle = (win: Page) =>
  win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .evaluateAll((els) => els.map((e) => e.querySelector('[data-label]')?.textContent.trim() ?? ''));

/** The folders the bottom left shows, by path. */
const folders = (win: Page) =>
  win
    .getByTestId('playlist-folders')
    .getByTestId('playlist-folder')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-path')));

const shownFolder = (win: Page) => win.getByTestId('playlist-items');

test('a folder playlist shows a folder at a time: its own items in the middle, its folders bottom left, back by the playlist; Next follows the whole order; Simple Mode keeps it whole', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(240_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-folders-'));
  const top = join(work, 'Placeholder Sabha');
  const { app } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  await placeholderFolder(win, top);

  // A smart playlist following it (+ New › Smart Playlist from a Folder…).
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, top);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  const node = win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Sabha' });
  const playlistId = (await node.getAttribute('data-node-id')) ?? '';
  // The playlist itself: every file in the folder's order, a header before each subfolder's part.
  await expect
    .poll(() => whole(win, playlistId), { timeout: 120_000 })
    .toEqual([
      'Opening.mp4',
      'Welcome.png',
      '# Week 1',
      'Clip.mp4',
      '# Week 1 › Videos',
      'Deep.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
    ]);

  // The top folder: its own items in the middle, its folders in the bottom left, named as on disk.
  await expect.poll(() => middle(win)).toEqual(['Opening.mp4', 'Welcome.png']);
  await expect.poll(() => folders(win)).toEqual(['Week 1', 'Week 2']);
  await expect(win.getByTestId('folder-crumbs')).toHaveText('Placeholder Sabha');
  await expect(win.getByTestId('column-left').getByTestId('playlist-folders')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a folder playlist’s top folder');

  // A subfolder: its own items, and its own folders, with the way back up.
  await win.getByTestId('playlist-folder').filter({ hasText: 'Week 1' }).click();
  await expect.poll(() => middle(win)).toEqual(['Clip.mp4']);
  await expect.poll(() => folders(win)).toEqual(['Week 1 › Videos']);
  await expect(win.getByTestId('folder-crumbs')).toHaveText('Placeholder Sabha›Week 1');
  await expect(win.getByTestId('folder-up')).toHaveText('Back to Placeholder Sabha');
  await win.getByTestId('playlist-folder').filter({ hasText: 'Videos' }).click();
  await expect.poll(() => middle(win)).toEqual(['Deep.mp4']);
  await expect(win.getByTestId('no-subfolders')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a folder two deep');
  // Up one by the way back, and by the crumbs.
  await win.getByTestId('folder-up').click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', 'Week 1');
  await win.getByTestId('folder-crumb').filter({ hasText: 'Placeholder Sabha' }).click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', '');
  // A folder holding only a folder says where its things are.
  await win.getByTestId('playlist-folder').filter({ hasText: 'Week 2' }).click();
  await expect(win.getByTestId('folder-only-folders')).toBeVisible();
  await expect.poll(() => folders(win)).toEqual(['Week 2 › Pictures']);
  // Clicking the playlist itself goes back to the top folder.
  await node.click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', '');
  await expect.poll(() => middle(win)).toEqual(['Opening.mp4', 'Welcome.png']);

  // Next follows the whole playlist; moving into another folder's part, the middle shows that folder.
  const item = (name: string) =>
    win.getByTestId('open-playlist').getByTestId('playlist-item').filter({ hasText: name });
  // One click puts the video up (Session 54).
  await item('Opening.mp4').click();
  await expect(item('Opening.mp4')).toHaveAttribute('data-live', 'true');
  const next = win.getByTestId('show-next');
  await next.click();
  await expect(item('Welcome.png')).toHaveAttribute('data-live', 'true');
  await next.click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', 'Week 1');
  await expect(item('Clip.mp4')).toHaveAttribute('data-live', 'true');
  await next.click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', 'Week 1 › Videos');
  await expect(item('Deep.mp4')).toHaveAttribute('data-live', 'true');
  await next.click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', 'Week 2 › Pictures');
  await expect(item('Cover.png')).toHaveAttribute('data-live', 'true');

  // Simple Mode: the whole playlist as before, headers and all.
  await chooseMenuItem(app, 'switch-mode');
  await win.getByTestId('simple-playlist').selectOption({ label: 'Placeholder Sabha' });
  await expect(win.getByTestId('simple-header')).toHaveText([
    'Week 1',
    'Week 1 › Videos',
    'Week 2 › Pictures',
  ]);
  await expect(win.getByTestId('simple-item')).toHaveCount(5);
  await expectNoSeriousA11yIssues(win, 'Simple Mode with a folder playlist');
  await app.close();
});

test('a folder playlist from before this session opens a folder at a time, and the Library sheet adds to the folder shown', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(180_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-folders-old-'));
  const top = join(work, 'Placeholder Earlier Sabha');
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 800 });
  const files = await placeholderFolder(win, top);
  const song = join(work, 'Placeholder Sheet Song.txt');
  writeFileSync(song, 'Placeholder sheet line one\n\nPlaceholder sheet line two\n');
  const ids = await importAndGetIds(win, [...files, song]);
  // As alpha.8 made a Dropbox folder link's playlist: a plain playlist, marked by nothing, a header before
  // each subfolder's part.
  const playlistId = await win.evaluate(
    async (media) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create('Placeholder Earlier Sabha', null, false);
      if (!made.ok) throw new Error(made.message);
      const [id = ''] = made.ids;
      const [opening = '', welcome = '', clip = '', deep = '', cover = ''] = media;
      await d.playlists.addItems(id, null, [
        { kind: 'media', mediaId: opening },
        { kind: 'media', mediaId: welcome },
        { kind: 'header', label: 'Week 1' },
        { kind: 'media', mediaId: clip },
        { kind: 'header', label: 'Week 1 › Videos' },
        { kind: 'media', mediaId: deep },
        { kind: 'header', label: 'Week 2 › Pictures' },
        { kind: 'media', mediaId: cover },
      ]);
      return id;
    },
    ids.slice(0, 5),
  );
  const node = win.getByTestId('playlist-node').filter({ hasText: 'Placeholder Earlier Sabha' });
  await node.click();
  await expect.poll(() => middle(win)).toEqual(['Opening.mp4', 'Welcome.png']);
  await expect.poll(() => folders(win)).toEqual(['Week 1', 'Week 2']);

  // The Library button opens the library over the left column; the playlist stays in view in the middle.
  await win.getByTestId('playlist-folder').filter({ hasText: 'Week 1' }).click();
  await expect(shownFolder(win)).toHaveAttribute('data-folder', 'Week 1');
  const button = win.getByTestId('library-button');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const sheet = win.getByTestId('library-sheet');
  await expect(sheet).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(win.locator('#library-search')).toBeFocused();
  await expect(win.getByTestId('open-playlist')).toBeInViewport({ ratio: 0.9 });
  await expectNoSeriousA11yIssues(win, 'the Library sheet', '[data-testid="library-sheet"]');

  // Add to playlist: at the end of the folder shown.
  const row = sheet.getByTestId('presentation-row').filter({ hasText: 'Placeholder Sheet Song' });
  await row.click();
  await sheet.getByTestId('add-to-playlist').click();
  await expect.poll(() => middle(win)).toEqual(['Clip.mp4', 'Placeholder Sheet Song']);
  expect(await whole(win, playlistId)).toEqual([
    'Opening.mp4',
    'Welcome.png',
    '# Week 1',
    'Clip.mp4',
    'Placeholder Sheet Song',
    '# Week 1 › Videos',
    'Deep.mp4',
    '# Week 2 › Pictures',
    'Cover.png',
  ]);

  // A drag from the sheet's media into the folder shown lands there too (after its last item).
  await sheet.getByRole('tab', { name: 'Media' }).click();
  const welcome = sheet.getByTestId('media-item').filter({ hasText: 'Welcome.png' });
  const last = win
    .getByTestId('open-playlist')
    .getByTestId('playlist-item')
    .filter({ hasText: 'Placeholder Sheet Song' });
  await mouseDrag(win, welcome, last, 'bottom');
  await expect.poll(() => middle(win)).toEqual(['Clip.mp4', 'Placeholder Sheet Song', 'Welcome.png']);

  // Esc shuts the sheet and gives the keyboard back to the Library button.
  await sheet.getByRole('tab', { name: 'Media' }).focus();
  await win.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
  await app.close();
});
