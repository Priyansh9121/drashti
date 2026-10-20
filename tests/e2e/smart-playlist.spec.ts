import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage, operatorReady, relaunchApp, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * A smart playlist following a folder (Session 26c): a temporary folder of
 * placeholder files, with subfolders. Files are added, taken away and
 * changed while Drashti runs and while it is closed, and the playlist is
 * checked each time. The test switches make Drashti look every second and
 * wait half a second for a file to hold still.
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
 * The open playlist's whole order, as it is kept: "# Header", "Name", "Name (not in the folder)". Read from the
 * playlist itself (Session 44: the window shows a folder playlist a folder at a time, folder-playlists.spec.ts).
 */
const shown = (win: Page) =>
  win.evaluate(async () => {
    const open = document.querySelector('[data-testid="playlist-node"][data-open="true"]');
    const items = await (globalThis as PageGlobals).drashti.playlists.items(
      open?.getAttribute('data-node-id') ?? '',
    );
    return items.map((i) => {
      if (i.kind === 'header') return `# ${i.label}`;
      return 'gone' in i && i.gone === true ? `${i.label} (not in the folder)` : i.label;
    });
  });

test('a smart playlist follows a folder: files added, taken away and changed, in subfolders too, before and after a restart (Session 26c)', async () => {
  test.skip(ffmpeg === null, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');
  test.setTimeout(300_000);
  const work = mkdtempSync(join(tmpdir(), 'drashti-smart-e2e-'));
  const folder = join(work, 'Placeholder Sabha');
  mkdirSync(join(folder, 'Week 1'), { recursive: true });
  const { app, userData } = await launchApp(QUICK);
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  makeVideo(join(folder, 'Opening.mp4'), '320x180');
  writeFileSync(
    join(folder, 'Notice.pdf'),
    makeTestPdf([{ width: 960, height: 540, color: [20, 83, 45], text: 'Notice' }]),
  );
  await makeTestImage(win, join(folder, 'Week 1', 'Darshan.png'), { color: '#7c2d12' });
  makeVideo(join(folder, 'Week 1', 'Clip.mp4'), '352x198');
  // Not what a smart playlist takes: words, and a hidden file.
  writeFileSync(join(folder, 'Read me.txt'), 'placeholder words');
  await makeTestImage(win, join(folder, '.hidden.png'), { color: '#000000' });

  // + New › Smart Playlist from a Folder…
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, folder);
  await win.getByRole('button', { name: 'New playlist or folder' }).click();
  await win.getByRole('menuitem', { name: 'Smart Playlist from a Folder…' }).click();
  const title = win.getByTestId('open-playlist').getByTestId('playlist-title');
  await expect(title).toHaveText('Placeholder Sabha');
  const node = win.getByTestId('playlist-node').first();
  await expect(node).toHaveAttribute('data-playlist-kind', 'smart');
  await expect(win.getByTestId('smart-folder')).toHaveText(folder);
  // It fills itself, in the folder's order: each folder's videos, then decks, then pictures.
  await expect
    .poll(() => shown(win), { timeout: 120_000 })
    .toEqual(['Opening.mp4', 'Notice', '# Week 1', 'Clip.mp4', 'Darshan.png']);
  await expect(win.getByTestId('smart-state')).toHaveText('What goes in the folder joins by itself.');
  await expectNoSeriousA11yIssues(win, 'a smart playlist', '[data-testid="open-playlist"]');

  // Moved by hand: Darshan first. It stays there.
  const playlistId = (await node.getAttribute('data-node-id')) ?? '';
  const items = () =>
    win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId);
  const darshan = (await items()).find((i) => i.label === 'Darshan.png');
  await win.evaluate(
    ({ id, item }) => (globalThis as PageGlobals).drashti.playlists.moveItems(id, [item], 0),
    { id: playlistId, item: darshan?.id ?? '' },
  );
  await expect
    .poll(() => shown(win))
    .toEqual(['Darshan.png', 'Opening.mp4', 'Notice', '# Week 1', 'Clip.mp4']);

  // Added: each joins at the end of its folder's part; a new subfolder gets a part of its own.
  makeVideo(join(folder, 'Week 1', 'Later.mp4'), '384x216');
  mkdirSync(join(folder, 'Week 2', 'Pictures'), { recursive: true });
  await makeTestImage(win, join(folder, 'Week 2', 'Pictures', 'Cover.png'), { color: '#1e3a8a' });
  await expect
    .poll(() => shown(win), { timeout: 60_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4',
      'Notice',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
    ]);

  // On the screens: changing its file never touches what is up.
  const cover = (await items()).find((i) => i.label === 'Cover.png');
  await win.evaluate(
    ({ playlistId, itemId }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'playItem', playlistId, itemId }),
    { playlistId, itemId: cover?.id ?? '' },
  );
  const up = () =>
    win.evaluate(async () => {
      const bg = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
      return bg?.kind === 'media' ? bg.mediaId : null;
    });
  const coverMedia = cover?.kind === 'media' ? cover.mediaId : '';
  await expect.poll(up).toBe(coverMedia);

  // Changed: imported again, its item replaced in place (the same item, now the new picture).
  await makeTestImage(win, join(folder, 'Week 2', 'Pictures', 'Cover.png'), {
    color: '#a16207',
    width: 96,
  });
  await expect
    .poll(
      async () => {
        const now = (await items()).find((i) => i.id === cover?.id);
        return now?.kind === 'media' ? now.mediaId : null;
      },
      { timeout: 60_000 },
    )
    .not.toBe(coverMedia);
  expect((await items()).map((i) => i.id)).toContain(cover?.id);
  expect(await up()).toBe(coverMedia);

  // Taken away: marked, not removed.
  rmSync(join(folder, 'Notice.pdf'));
  await expect
    .poll(() => shown(win), { timeout: 30_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4',
      'Notice (not in the folder)',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
    ]);
  await expect(win.getByTestId('smart-remove-missing')).toHaveText('Remove the missing (1)');
  const clipItem = (await items()).find((i) => i.label === 'Clip.mp4');
  await app.close();

  // Closed: a file added, one changed and one taken away; Drashti catches up when it starts.
  makeVideo(join(folder, 'Week 2', 'While closed.mp4'), '416x234');
  const clip = readFileSync(join(folder, 'Week 1', 'Clip.mp4'));
  rmSync(join(folder, 'Week 1', 'Clip.mp4'));
  makeVideo(join(folder, 'Week 1', 'Clip.mp4'), '448x252');
  expect(readFileSync(join(folder, 'Week 1', 'Clip.mp4')).equals(clip)).toBe(false);
  rmSync(join(folder, 'Opening.mp4'));
  const again = await relaunchApp(userData, QUICK);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await win2.setViewportSize({ width: 1280, height: 720 });
  await win2.getByTestId('playlist-node').first().click();
  await expect
    .poll(() => shown(win2), { timeout: 60_000 })
    .toEqual([
      'Darshan.png',
      'Opening.mp4 (not in the folder)',
      'Notice (not in the folder)',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
      '# Week 2',
      'While closed.mp4',
    ]);
  // The changed clip is the new one, in the same item.
  const after = await win2.evaluate(
    (id) => (globalThis as PageGlobals).drashti.playlists.items(id),
    playlistId,
  );
  const clipNow = after.find((i) => i.id === clipItem?.id);
  expect(
    clipNow?.kind === 'media' && clipItem?.kind === 'media' && clipNow.mediaId !== clipItem.mediaId,
  ).toBe(true);

  // The folder gone (a USB stick taken out): said plainly, the items kept; back, it carries on.
  renameSync(folder, join(work, 'Away'));
  await expect(win2.getByTestId('smart-bar')).toHaveAttribute('data-state', 'folder-gone', {
    timeout: 30_000,
  });
  await expect(win2.getByTestId('smart-state')).toContainText('The folder is not there');
  expect(await shown(win2)).toHaveLength(10);
  renameSync(join(work, 'Away'), folder);
  await expect(win2.getByTestId('smart-bar')).toHaveAttribute('data-state', 'following', { timeout: 30_000 });

  // One button takes out the missing; Undo brings them back, still marked.
  await win2.getByTestId('smart-remove-missing').click();
  await expect
    .poll(() => shown(win2))
    .toEqual([
      'Darshan.png',
      '# Week 1',
      'Clip.mp4',
      'Later.mp4',
      '# Week 2 › Pictures',
      'Cover.png',
      '# Week 2',
      'While closed.mp4',
    ]);
  await expect(win2.getByTestId('smart-remove-missing')).toHaveCount(0);
  await win2.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect.poll(() => shown(win2)).toContain('Notice (not in the folder)');
  await expect(win2.getByTestId('smart-remove-missing')).toHaveText('Remove the missing (2)');
  await again.app.close();
  rmSync(work, { recursive: true, force: true });
});
