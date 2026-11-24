import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoEditResult } from '../../src/shared/video-edit';
import {
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Save trimmed video (alpha.22). The owner, 24 Nov 2026: "i am unable to save trimmed video, give proper option of
 * save trimmed video", and where: "Trim on a row". His Wallpaper is up on LIVE all the time. A row's Trim (start, end
 * and markers)… → Save waited while ANYTHING was up (a still slide, a picture, music, a message: shared nothingUp), and
 * the Wallpaper covers what is up without taking it off; the row said only Preparing, never why. Now only a video or
 * a sound playing, the stream on air or a recording holds a save, and the row says which; a notice says when the
 * trimmed video is in Media, with Show in Media. Edit Video's Save shared the same rule.
 *
 * Placeholder media only: FFmpeg's test pattern and a tone, a flat picture, a placeholder slide's words.
 */

function ffmpeg(args: string[]): void {
  const path = testFfmpeg();
  if (!path) throw new Error('This test needs Drashti’s bundled FFmpeg.');
  const r = spawnSync(path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    windowsHide: true,
  });
  expect(r.status, r.error?.message ?? r.stderr.toString()).toBe(0);
}

/** A 4-second placeholder video (test pattern and a tone), a keyframe every second. */
function placeholderVideo(file: string, hue: number): string {
  ffmpeg([
    ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=4'],
    ...['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4'],
    ...['-vf', `hue=h=${String(hue)}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25'],
    ...['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
  ]);
  return file;
}

/** A flat placeholder picture. */
function placeholderPicture(file: string): string {
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x336699:s=320x180:d=1', '-frames:v', '1', file]);
  return file;
}

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(
    (c) =>
      (globalThis as PageGlobals).drashti.engine.dispatch(
        c as Parameters<PageGlobals['drashti']['engine']['dispatch']>[0],
      ),
    command,
  );

const live = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The names in Media. */
const mediaNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listMedia()).map((m) => m.name),
  );

/** The stream "on air" by the tests' hook (DRASHTI_TEST_ON_AIR_HOOK): it never opens a stream. */
const onAir = (app: ElectronApplication, on: boolean) =>
  app.evaluate((_electron, air) => {
    const hook = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
    if (!hook) throw new Error('The on-air test hook is missing.');
    hook(air);
  }, on);

/** A playlist with one row for each video, open in the middle. */
async function videoPlaylist(win: Page, name: string, mediaIds: string[]): Promise<string[]> {
  const rows = await win.evaluate(
    async ({ name, mediaIds }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const added = await d.playlists.addItems(
        made.ids[0] ?? '',
        null,
        mediaIds.map((mediaId) => ({ kind: 'media' as const, mediaId })),
      );
      if (!added.ok) throw new Error(added.message);
      return added.ids;
    },
    { name, mediaIds },
  );
  await win.getByTestId('playlist-node').filter({ hasText: name }).click();
  return rows;
}

const videoRow = (win: Page, rowId: string) =>
  win.getByTestId('playlist-item').and(win.locator(`[data-item-id="${rowId}"]`));

/** The operator's Trim on a row: its start and end typed, then its Save pressed (the dialog closes). */
async function trimOnRow(win: Page, rowId: string, start: string, end: string): Promise<void> {
  await videoRow(win, rowId).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
  const dialog = win.getByTestId('markers-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('markers-start').fill(start);
  await dialog.getByTestId('markers-end').fill(end);
  await dialog.getByTestId('markers-save').click();
  await expect(dialog).toHaveCount(0);
}

async function start(env: Record<string, string> = {}) {
  const { app } = await launchApp(env);
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win };
}

/** A placeholder presentation of one still slide (words only), up on LIVE. */
async function stillSlideUp(win: Page, dir: string): Promise<void> {
  const words = join(dir, 'Placeholder still slide.txt');
  writeFileSync(words, '[Verse]\nPlaceholder words that stay up\n');
  const [presentationId = ''] = await importAndGetIds(win, [words]);
  expect(presentationId).not.toBe('');
  expect((await dispatch(win, { type: 'goLive', presentationId, slideIndex: 0 })).ok).toBe(true);
  await expect.poll(async () => (await live(win)).layers.slide?.presentationId).toBe(presentationId);
}

const CUT_MS = 30_000;

/** Export…'s save dialog answered with `path` (never a real dialog in a test). */
const exportTo = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, to) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: to });
  }, path);

/** The sha256 of a video in Media, read through Drashti's own media address. */
const mediaSha = (app: ElectronApplication, mediaId: string) =>
  app
    .evaluate(async ({ net }, id) => {
      const response = await net.fetch(`drashti-media://media/${id}`);
      if (!response.ok) throw new Error('The video cannot be read.');
      return [...new Uint8Array(await response.arrayBuffer())];
    }, mediaId)
    .then((bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex'));

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('Trim on a row with only the Wallpaper up saves the trimmed video into Media', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-trimmed-a-'));
  const { app, win } = await start();
  try {
    const [video = ''] = await importAndGetIds(win, [placeholderVideo(join(dir, 'Placeholder one.mp4'), 0)]);
    const [row = ''] = await videoPlaylist(win, 'Placeholder wallpaper trims', [video]);
    expect((await dispatch(win, { type: 'setWallpaper', on: true })).ok).toBe(true);
    await expect.poll(async () => (await live(win)).wallpaper).toBe(true);
    await trimOnRow(win, row, '0:01', '0:03');
    await expect
      .poll(() => mediaNames(win), {
        timeout: CUT_MS,
        message: 'the trimmed video is in Media with the Wallpaper up and nothing under it',
      })
      .toContain('Placeholder one trimmed.mp4');
    expect((await live(win)).wallpaper).toBe(true);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Trim on a row with the Wallpaper up over a still slide saves the trimmed video into Media', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-trimmed-b-'));
  const { app, win } = await start();
  try {
    const [video = ''] = await importAndGetIds(win, [placeholderVideo(join(dir, 'Placeholder two.mp4'), 90)]);
    const [row = ''] = await videoPlaylist(win, 'Placeholder covered trims', [video]);
    // The owner's LIVE: a slide was up, and the Wallpaper covers it (it stays under the Wallpaper, not taken off).
    await stillSlideUp(win, dir);
    expect((await dispatch(win, { type: 'setWallpaper', on: true })).ok).toBe(true);
    await expect.poll(async () => (await live(win)).wallpaper).toBe(true);
    expect((await live(win)).layers.slide).not.toBeNull();
    await trimOnRow(win, row, '0:01', '0:03');
    await expect
      .poll(() => mediaNames(win), {
        timeout: CUT_MS,
        message: 'the trimmed video is in Media with the Wallpaper up over a still slide',
      })
      .toContain('Placeholder two trimmed.mp4');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Trim on a row with a picture up saves the trimmed video into Media', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-trimmed-c-'));
  const { app, win } = await start();
  try {
    const [video = '', picture = ''] = await importAndGetIds(win, [
      placeholderVideo(join(dir, 'Placeholder three.mp4'), 180),
      placeholderPicture(join(dir, 'Placeholder picture.png')),
    ]);
    const [row = ''] = await videoPlaylist(win, 'Placeholder picture trims', [video]);
    const shown = await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: picture, media: 'image', fit: 'fit' },
    });
    expect(shown.ok).toBe(true);
    await trimOnRow(win, row, '0:00.5', '0:02.5');
    await expect
      .poll(() => mediaNames(win), {
        timeout: CUT_MS,
        message: 'the trimmed video is in Media with a picture up',
      })
      .toContain('Placeholder three trimmed.mp4');
    expect((await live(win)).layers.background).toMatchObject({ kind: 'media', mediaId: picture });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Save trimmed video waits while a video plays or the stream is on air, says why, and tells when it is in Media', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-trimmed-d-'));
  const { app, win } = await start({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    const [playing = '', four = '', five = ''] = await importAndGetIds(win, [
      placeholderVideo(join(dir, 'Placeholder playing.mp4'), 30),
      placeholderVideo(join(dir, 'Placeholder four.mp4'), 120),
      placeholderVideo(join(dir, 'Placeholder five.mp4'), 240),
    ]);
    const [rowFour = '', rowFive = ''] = await videoPlaylist(win, 'Placeholder waiting trims', [four, five]);
    // A video playing as the background holds a save: the encoding would compete with its playing.
    const up = await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: playing, media: 'video', fit: 'fit', loop: true },
    });
    expect(up.ok).toBe(true);

    // The row's Trim names what its Save does: a trimmed video, once its points cut the video.
    await videoRow(win, rowFour).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
    const dialog = win.getByTestId('markers-dialog');
    await dialog.getByTestId('markers-start').fill('0:01');
    await dialog.getByTestId('markers-end').fill('0:03');
    await expect(dialog.getByTestId('markers-save')).toHaveText('Save trimmed video');
    await dialog.getByTestId('markers-save').click();
    await expect(dialog).toHaveCount(0);
    const status = videoRow(win, rowFour).getByTestId('trim-status');
    await expect(status).toHaveText('Waiting: a video is playing');
    expect(await mediaNames(win)).not.toContain('Placeholder four trimmed.mp4');

    // Paused, it no longer plays: the save goes on, and the notice says where the new video is.
    expect((await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } })).ok).toBe(true);
    const notice = win.getByTestId('operator-notice').filter({ hasText: 'Placeholder four trimmed.mp4' });
    await expect(notice).toContainText('“Placeholder four trimmed.mp4” is in Media.', { timeout: CUT_MS });
    await expect(status).toHaveCount(0);
    expect(await mediaNames(win)).toContain('Placeholder four trimmed.mp4');
    const cutId = await win.evaluate(
      async (name) =>
        (await (globalThis as PageGlobals).drashti.library.listMedia()).find((m) => m.name === name)?.id ??
        '',
      'Placeholder four trimmed.mp4',
    );
    // Show in Media: Media's list open with the new video marked.
    await notice.getByRole('button', { name: 'Show in Media', exact: true }).click();
    await expect(win.getByTestId('library-tab-media')).toHaveAttribute('aria-selected', 'true');
    await expect(
      win.getByTestId('media-item').filter({ hasText: 'Placeholder four trimmed.mp4' }),
    ).toHaveAttribute('data-marked', 'true');
    await closeLibrary(win);
    // Export… on the notice: the finished file copied byte for byte where chosen (Downloads), never made again.
    const downloads = join(dir, 'Downloads');
    mkdirSync(downloads);
    await exportTo(app, join(downloads, 'Placeholder four trimmed.mp4'));
    await notice.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(win.getByTestId('operator-notice')).toContainText(
      'Exported “Placeholder four trimmed.mp4” to Downloads.',
    );
    expect(sha(join(downloads, 'Placeholder four trimmed.mp4'))).toBe(await mediaSha(app, cutId));
    // And from the row's Trim, once its trimmed video is made: never over the file there.
    await videoRow(win, rowFour).click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
    await dialog.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect(win.getByTestId('operator-notice')).toContainText(
      'Exported “Placeholder four trimmed (2).mp4” to Downloads.',
    );
    expect(sha(join(downloads, 'Placeholder four trimmed (2).mp4'))).toBe(await mediaSha(app, cutId));
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // On air, the save waits, and says so; off air it goes on.
    await onAir(app, true);
    await trimOnRow(win, rowFive, '0:00.5', '0:02');
    await expect(videoRow(win, rowFive).getByTestId('trim-status')).toHaveText(
      'Waiting: the stream is on air',
    );
    await onAir(app, false);
    await expect.poll(() => mediaNames(win), { timeout: CUT_MS }).toContain('Placeholder five trimmed.mp4');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const videoEdit = (win: Page, id: string): Promise<VideoEditResult> =>
  win.evaluate((id) => {
    const media = (globalThis as PageGlobals).drashti.media as PageGlobals['drashti']['media'] & {
      videoEdit(id: string): Promise<VideoEditResult>;
    };
    return media.videoEdit(id);
  }, id);

test('Edit Video’s Save goes on with the Wallpaper up over a still slide, and says why it waits while a video plays', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-trimmed-e-'));
  const { app, win } = await start();
  try {
    const [video = '', playing = ''] = await importAndGetIds(win, [
      placeholderVideo(join(dir, 'Placeholder edited.mp4'), 300),
      placeholderVideo(join(dir, 'Placeholder edit playing.mp4'), 60),
    ]);
    await stillSlideUp(win, dir);
    expect((await dispatch(win, { type: 'setWallpaper', on: true })).ok).toBe(true);
    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    await win
      .getByTestId('media-item')
      .filter({ hasText: 'Placeholder edited.mp4' })
      .click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Edit Video…', exact: true }).click();
    const dialog = win.getByTestId('edit-video');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Playback', exact: true }).click();
    await dialog.getByLabel('Speed').selectOption('2');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    // Its saved copy is made under the Wallpaper over a still slide (until alpha.22 it stayed Preparing for good).
    await expect
      .poll(() => videoEdit(win, video), { timeout: 60_000 })
      .toMatchObject({ ok: true, edit: { revision: 1, state: 'ready' } });
    await expect(dialog.getByTestId('edit-video-status')).toHaveText('Ready for next showing');

    // A video playing holds it, and Edit Video says so.
    const up = await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: playing, media: 'video', fit: 'fit', loop: true },
    });
    expect(up.ok).toBe(true);
    await dialog.getByLabel('Speed').selectOption('1.5');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog.getByTestId('edit-video-status')).toHaveText('Preparing');
    await expect(dialog.getByTestId('edit-video-waiting')).toHaveText('Waiting: a video is playing');
    expect(await videoEdit(win, video)).toMatchObject({
      ok: true,
      edit: { revision: 2, state: 'preparing' },
    });
    expect((await dispatch(win, { type: 'clearAll' })).ok).toBe(true);
    await expect
      .poll(() => videoEdit(win, video), { timeout: 60_000 })
      .toMatchObject({ ok: true, edit: { revision: 2, state: 'ready' } });
    await expect(dialog.getByTestId('edit-video-status')).toHaveText('Ready for next showing');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
