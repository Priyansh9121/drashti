import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, readSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import { dropPaths } from './folder-drop';
import {
  audienceScreen,
  makeClip,
  openNewPlaylist,
  openPlaylist,
  pictureUp,
  row,
  SCREENS,
  wallpaperAndPicture,
  watch,
} from './hall-looks';
import { testFfmpeg } from './stream-helpers';

/*
 * A file still being copied when its folder is dropped (Q60-31, the owner's own bug: his video came from a Dropbox
 * folder he dropped on Drashti). x46's hunt (CI x46-1120-112649-63694) showed, on both systems: a video whose copy
 * stalls for longer than the folder's 3 s wait is taken half-written (its movie box, at its end, not there yet), and
 * its row, put up, shows black on the hall and LIVE; it is taken again in place once whole. A file the folder follows
 * goes in only once it is whole as well as still: until then no row of it can go up, and the smart playlist's line
 * says which file is still being copied. Generated media only, placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

/** The playlist of this name, once there. */
async function playlistNamed(win: Page, name: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        id =
          (
            await win.evaluate(
              async (wanted) =>
                (await (globalThis as PageGlobals).drashti.playlists.tree()).find((n) => n.name === wanted) ??
                null,
              name,
            )
          )?.id ?? '';
        return id;
      },
      { timeout: 30_000, message: `the playlist ${name}` },
    )
    .not.toBe('');
  return id;
}

/** The media rows of that playlist now. */
const mediaRows = (win: Page, playlistId: string) =>
  win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.playlists.items(id)).flatMap((i) =>
        i.kind === 'media' ? [{ label: i.label, item: i.id, mediaId: i.mediaId }] : [],
      ),
    playlistId,
  );

test('a video still being copied into a folder dropped on Drashti (its copy stalling past the folder’s 3 s wait) never goes in half-written: no row of it until it is whole, the smart playlist’s line names it as still being copied, and once whole its row plays its picture', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-still-copying-'));
  // The owner's file's shape, its movie box at the end: half of it is no video yet.
  const source = makeClip(join(dir, 'Placeholder copy source.mp4'), 'owner', 60, 466);
  const folder = join(dir, 'Placeholder syncing folder');
  mkdirSync(folder);
  const target = join(folder, 'Placeholder syncing.mp4');
  const size = statSync(source).size;
  const fd = openSync(source, 'r');
  const chunk = Buffer.alloc(Math.ceil(size / 10));
  const writeTenth = (n: number) => {
    const got = readSync(fd, chunk, 0, Math.min(chunk.length, size - n * chunk.length), n * chunk.length);
    if (got > 0) appendFileSync(target, chunk.subarray(0, got));
  };
  // The first 40 % at once, then a stall of 8 s (past the folder's 3 s wait), then the rest a tenth each half second.
  for (const n of [0, 1, 2, 3]) writeTenth(n);
  const { app } = await launchApp(SCREENS);
  const timers: ReturnType<typeof setTimeout>[] = [];
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = (await audienceScreen(app, win)).page;
    const beforeId = await wallpaperAndPicture(win, dir);
    await openNewPlaylist(win, 'Placeholder still copying holder');
    await dropPaths(win, win.getByTestId('open-playlist'), [folder]);
    const listId = await playlistNamed(win, 'Placeholder syncing folder');
    await openPlaylist(win, 'Placeholder syncing folder');
    for (const n of [4, 5, 6, 7, 8, 9])
      timers.push(
        setTimeout(
          () => {
            writeTenth(n);
          },
          8000 + (n - 4) * 500,
        ),
      );
    // While it is still being copied (the stall's 8 s): no row of it, and the line names it.
    const stallEnds = Date.now() + 7000;
    let named = false;
    while (Date.now() < stallEnds) {
      expect(statSync(target).size, 'still being copied').toBeLessThan(size);
      expect(await mediaRows(win, listId), 'no row of a file still being copied').toEqual([]);
      const line = (await win.getByTestId('smart-state').textContent()) ?? '';
      if (line.includes('Placeholder syncing.mp4') && line.includes('still being copied')) named = true;
      await letTimePass(win, 500, 'the folder is watched while its file is still being copied');
    }
    expect(named, 'the smart playlist’s line named the file still being copied').toBe(true);
    // Whole: its row comes, and plays its picture over the picture before, never black.
    await expect.poll(() => statSync(target).size, { timeout: 30_000 }).toBe(size);
    let rows: { label: string; item: string; mediaId: string }[] = [];
    await expect
      .poll(async () => (rows = await mediaRows(win, listId)).length, {
        timeout: 60_000,
        message: 'its row, once whole',
      })
      .toBe(1);
    const whole = rows[0];
    if (!whole) throw new Error('no row');
    await pictureUp(win, hall, beforeId);
    await row(win, whole.item).click();
    const w = await watch(app, win, hall, whole.mediaId, 30_000, true);
    expect(w.video, `its picture on the hall: ${w.looks.join(' | ')}`).toBe(true);
    expect(w.black, `never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
  } finally {
    for (const t of timers) clearTimeout(t);
    closeSync(fd);
    await app.close();
  }
});
