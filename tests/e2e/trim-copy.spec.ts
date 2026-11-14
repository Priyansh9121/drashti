import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  holdStill,
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  relaunchApp,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

function ffmpeg(args: string[], input?: Buffer) {
  const path = testFfmpeg();
  if (!path) throw new Error('This test needs Drashti’s bundled FFmpeg.');
  const result = spawnSync(path, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    input,
    windowsHide: true,
  });
  expect(result.status, result.error?.message ?? result.stderr.toString()).toBe(0);
  return result;
}

const fps = 25;
const seconds = 6;
const bits = 8;

/** Write the frame number as eight black or white stripes in every frame, with keyframes 1 second apart. */
function numberedVideo(file: string): void {
  const width = 160;
  const height = 90;
  const frameSize = (width * height * 3) / 2;
  const bytes = Buffer.alloc(frameSize * fps * seconds, 128);
  const stripe = width / bits;
  const row = Buffer.alloc(width);
  for (let i = 0; i < fps * seconds; i++) {
    for (let bit = 0; bit < bits; bit++)
      row.fill(i & (1 << bit) ? 235 : 16, bit * stripe, (bit + 1) * stripe);
    for (let y = 0; y < height; y++) row.copy(bytes, i * frameSize + y * width);
  }
  ffmpeg(
    [
      '-f',
      'rawvideo',
      '-pixel_format',
      'yuv420p',
      '-video_size',
      '160x90',
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-f',
      'lavfi',
      '-i',
      `sine=f=440:r=48000:d=${String(seconds)}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      String(fps),
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-t',
      String(seconds),
      '-movflags',
      '+faststart',
      file,
    ],
    bytes,
  );
}

function framesOf(file: string): number[] {
  const { stdout, stderr } = ffmpeg([
    '-loglevel',
    'info',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-fps_mode',
    'passthrough',
    '-vf',
    'scale=8:2:flags=area,format=gray',
    '-threads',
    '1',
    '-f',
    'rawvideo',
    '-',
  ]);
  expect(stderr.toString()).toMatch(/Video: h264/u);
  expect(stderr.toString()).toMatch(/Audio: aac/u);
  const frameSize = bits * 2;
  expect(stdout.length % frameSize).toBe(0);
  return Array.from({ length: stdout.length / frameSize }, (_, frame) => {
    const row = stdout.subarray(frame * frameSize, frame * frameSize + bits);
    let value = 0;
    for (const [bit, intensity] of row.entries()) if (intensity >= 128) value |= 1 << bit;
    return value;
  });
}

function stamp(file: string) {
  return {
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    mtime: statSync(file).mtimeMs,
  };
}

/** Use the existing test hook for the stream’s on-air state. It never opens a stream. */
const onAir = (app: ElectronApplication, on: boolean) =>
  app.evaluate((_electron, air) => {
    const hook = (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir;
    if (!hook) throw new Error('The on-air test hook is missing.');
    hook(air);
  }, on);

const items = (win: Page, playlistId: string) =>
  win.evaluate((id) => (globalThis as PageGlobals).drashti.playlists.items(id), playlistId);

const legacyPoints = { startMs: 400, endMs: 5500 };

const markLegacy = (win: Page, mediaId: string) =>
  win.evaluate(
    ({ mediaId, points }) =>
      (globalThis as PageGlobals).drashti.media.setMarkers(mediaId, { ...points, markers: [] }),
    { mediaId, points: legacyPoints },
  );

const makeVideoPlaylist = (win: Page, mediaId: string, name: string) =>
  win.evaluate(
    async ({ mediaId, name }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.playlists.create(name, null, false);
      if (!made.ok) throw new Error(made.message);
      const playlistId = made.ids[0] ?? '';
      const added = await d.playlists.addItems(playlistId, null, [{ kind: 'media', mediaId }]);
      if (!added.ok) throw new Error(added.message);
      return { playlistId, rowId: added.ids[0] ?? '' };
    },
    { mediaId, name },
  );

const videoRow = (win: Page, rowId: string) =>
  win.getByTestId('playlist-item').and(win.locator(`[data-item-id="${rowId}"]`));

const background = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );

test('Trim waits while on air, cuts exact frames in the same row, and widens or resets from the original', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-copy-'));
  const { app, userData } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const source = join(dir, 'Placeholder numbered.mp4');
    numberedVideo(source);
    const sourceBefore = stamp(source);
    const [mediaId = ''] = await importAndGetIds(win, [source]);
    expect(mediaId).not.toBe('');
    expect((await markLegacy(win, mediaId)).ok).toBe(true);
    const sha = sourceBefore.sha256;
    const original = join(userData, 'Media', sha.slice(0, 2), `${sha}.mp4`);
    const originalBefore = stamp(original);
    const cut = join(dirname(original), 'Placeholder numbered trimmed.mp4');
    const playlistName = 'Placeholder trim playlist';
    const edited = await makeVideoPlaylist(win, mediaId, playlistName);
    const other = await makeVideoPlaylist(win, mediaId, 'Placeholder other playlist');
    const set = await win.evaluate(
      (id) => (globalThis as PageGlobals).drashti.playlists.setWhenEnds(id, 'freeze'),
      edited.rowId,
    );
    expect(set.ok).toBe(true);
    await win.getByTestId('playlist-node').filter({ hasText: playlistName }).click();
    const row = videoRow(win, edited.rowId);
    const name = row.locator('[data-label]');
    await expect(name).toHaveText('Placeholder numbered.mp4');
    const dialog = win.getByTestId('markers-dialog');
    const openTrim = async () => {
      await row.click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
      await expect(dialog).toBeVisible();
    };
    const saveCut = async (start: string, end: string) => {
      await dialog.getByTestId('markers-start').fill(start);
      await dialog.getByTestId('markers-end').fill(end);
      await dialog.getByTestId('markers-save').click();
      await expect(dialog).toHaveCount(0);
    };
    const preparing = row.getByTestId('trim-preparing');

    await onAir(app, true);
    await openTrim();
    await saveCut('0:01', '0:03');
    await expect(preparing).toBeVisible();
    await openTrim();
    await expect(dialog.getByTestId('markers-save')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(preparing).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    await expect(dialog.getByTestId('markers-save')).toBeEnabled();
    expect(await items(win, edited.playlistId)).toMatchObject([{ id: edited.rowId, mediaId }]);
    expect(existsSync(cut)).toBe(false);

    const preview = dialog.locator('video');
    await preview.evaluate(async (video) => {
      if (!(video instanceof HTMLVideoElement)) throw new Error('Trim’s preview is missing.');
      if (video.readyState < HTMLMediaElement.HAVE_METADATA)
        await new Promise<void>((resolve) =>
          video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
        );
      await new Promise<void>((resolve) => {
        const atFirstSeek: VideoFrameRequestCallback = (_now, { mediaTime }) => {
          if (Math.abs(mediaTime - 0.8) < 0.001) resolve();
          else video.requestVideoFrameCallback(atFirstSeek);
        };
        video.requestVideoFrameCallback(atFirstSeek);
        video.currentTime = 0.8;
      });
    });
    const here = dialog.getByRole('button', { name: 'Here', exact: true }).first();
    await here.evaluate((button) => {
      const video = button.closest('form')?.querySelector('video');
      if (!(button instanceof HTMLButtonElement) || !video) throw new Error('Trim’s preview is missing.');
      // Use Here in the same turn as a seek, before the new frame can be presented.
      video.currentTime = 1.2;
      button.click();
    });
    await expect(dialog.getByTestId('markers-start')).toHaveValue('0:01.2');
    await here.evaluate((button) => {
      const video = button.closest('form')?.querySelector('video');
      if (!video) throw new Error('Trim’s preview is missing.');
      video.currentTime = 1.6;
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    await expect(dialog.getByTestId('markers-start')).toHaveValue('0:01.6');

    await saveCut('0:01.415', '0:04.6');
    await expect(preparing).toHaveText('Preparing');
    await holdStill(() => !existsSync(cut), 2200, 'the stream is on air');
    expect(await items(win, edited.playlistId)).toMatchObject([{ id: edited.rowId, mediaId }]);

    // The pending row can go live using the original. Taking the stream off air alone does not release the cut.
    await row.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId });
    await onAir(app, false);
    await holdStill(() => !existsSync(cut), 2200, 'the original is still live');
    await expect(preparing).toHaveText('Preparing');
    await win.getByRole('button', { name: 'Clear all' }).click();

    await expect(name).toHaveText('Placeholder numbered trimmed.mp4', { timeout: 30_000 });
    await expect(preparing).toHaveCount(0);
    const [first] = await items(win, edited.playlistId);
    if (first?.kind !== 'media') throw new Error('The trimmed video is missing from its playlist.');
    expect(first).toMatchObject({ id: edited.rowId, whenEnds: 'freeze' });
    expect(first.mediaId).not.toBe(mediaId);
    expect(framesOf(cut)).toEqual(Array.from({ length: 80 }, (_, i) => 35 + i));

    await row.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId: first.mediaId });
    await win.getByRole('button', { name: 'Clear all' }).click();

    await openTrim();
    await expect(dialog.getByTestId('markers-start')).toHaveValue('0:01.4');
    await expect(dialog.getByTestId('markers-end')).toHaveValue('0:04.6');
    await expect
      .poll(() => dialog.locator('video').evaluate((v: HTMLVideoElement) => v.duration))
      .toBeCloseTo(seconds, 1);
    await saveCut('0:00.8', '0:05.6');

    const currentMedia = async () => {
      const [item] = await items(win, edited.playlistId);
      return item?.kind === 'media' && item.id === edited.rowId ? item.mediaId : null;
    };
    await expect
      .poll(
        async () => {
          const current = await currentMedia();
          return current !== null && current !== first.mediaId && current !== mediaId;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const wider = await app.evaluate(
      async ({ net }, id) => {
        const response = await net.fetch(`drashti-media://media/${id ?? ''}`);
        if (!response.ok) throw new Error('The widened cut cannot be read.');
        return [...new Uint8Array(await response.arrayBuffer())];
      },
      await currentMedia(),
    );
    const widenedFile = join(dir, 'Widened placeholder cut.mp4');
    writeFileSync(widenedFile, Buffer.from(wider));
    expect(framesOf(widenedFile)).toEqual(Array.from({ length: 120 }, (_, i) => 20 + i));

    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Reset to original', exact: true }).click();
    await expect.poll(currentMedia).toBe(mediaId);
    await expect(name).toHaveText('Placeholder numbered.mp4');
    expect(await items(win, other.playlistId)).toMatchObject([{ id: other.rowId, mediaId }]);
    await row.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId });
    expect(await background(win)).not.toHaveProperty('clip');
    await win.getByRole('button', { name: 'Clear all' }).click();
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder other playlist' }).click();
    await videoRow(win, other.rowId).click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId, clip: legacyPoints });
    expect(stamp(source)).toEqual(sourceBefore);
    expect(stamp(original)).toEqual(originalBefore);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Reset to original clears legacy playback points for just that playlist row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-trim-legacy-'));
  const { app } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    const file = join(dir, 'Placeholder legacy.mp4');
    numberedVideo(file);
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    expect(mediaId).not.toBe('');
    expect((await markLegacy(win, mediaId)).ok).toBe(true);
    const first = await makeVideoPlaylist(win, mediaId, 'Placeholder legacy playlist');
    const other = await makeVideoPlaylist(win, mediaId, 'Placeholder second playlist');
    const select = (name: string) => win.getByTestId('playlist-node').filter({ hasText: name }).click();
    const clear = () => win.getByRole('button', { name: 'Clear all' }).click();

    await select('Placeholder legacy playlist');
    const row = videoRow(win, first.rowId);
    await row.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId, clip: legacyPoints });
    await clear();
    await row.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Reset to original', exact: true }).click();
    await expect
      .poll(() => win.evaluate((id) => (globalThis as PageGlobals).drashti.media.rowTrim(id), first.rowId))
      .toMatchObject({ canReset: false, markers: { startMs: null, endMs: null } });
    await row.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId });
    expect(await background(win)).not.toHaveProperty('clip');
    expect(await items(win, first.playlistId)).toMatchObject([{ id: first.rowId, mediaId }]);
    await clear();

    await select('Placeholder second playlist');
    const otherRow = videoRow(win, other.rowId);
    await otherRow.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId, clip: legacyPoints });
    await clear();

    // Clearing both fields in Trim also puts the original video back in this row.
    await otherRow.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Trim (start, end and markers)…' }).click();
    const dialog = win.getByTestId('markers-dialog');
    await dialog.getByTestId('markers-start').fill('');
    await dialog.getByTestId('markers-end').fill('');
    await dialog.getByTestId('markers-save').click();
    await expect(dialog).toHaveCount(0);
    await otherRow.click();
    await expect.poll(() => background(win)).toMatchObject({ kind: 'media', mediaId });
    expect(await background(win)).not.toHaveProperty('clip');
    expect(await items(win, other.playlistId)).toMatchObject([{ id: other.rowId, mediaId }]);
    const stored = await win.evaluate((id) => (globalThis as PageGlobals).drashti.media.markers(id), mediaId);
    expect(stored).toMatchObject(legacyPoints);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a Trim accepted while the show is busy continues after a clean restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-resume-trim-'));
  const first = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  let app = first.app;
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const file = join(dir, 'Placeholder restart clip.mp4');
    numberedVideo(file);
    const before = stamp(file);
    const [mediaId = ''] = await importAndGetIds(win, [file]);
    const { playlistId, rowId } = await makeVideoPlaylist(win, mediaId, 'Placeholder restart trim');
    await onAir(app, true);
    const points = { startMs: 800, endMs: 2400, markers: [] };
    const accepted = await win.evaluate(
      ({ rowId, mediaId, points }) =>
        (globalThis as PageGlobals).drashti.media.applyRowTrim(rowId, { mediaId, points }),
      { rowId, mediaId, points },
    );
    expect(accepted).toEqual({ ok: true });
    expect(await items(win, playlistId)).toMatchObject([{ id: rowId, mediaId }]);
    await app.close();

    app = (await relaunchApp(first.userData)).app;
    const reopened = await operatorPage(app);
    await operatorReady(reopened);
    // The row says Preparing from the start (TM-1), as the cut waits to carry on (it waits AFTER_START_MS, 10 s, after
    // the window has loaded, then for nothing to be up), until it is taken in.
    const preparingRows = () =>
      reopened.evaluate(() => (globalThis as PageGlobals).drashti.media.preparingTrims());
    expect(await preparingRows()).toEqual([rowId]);
    await sizeOperatorWindow(app, reopened, CI_WINDOW);
    await reopened.getByTestId('playlist-node').filter({ hasText: 'Placeholder restart trim' }).click();
    const preparing = videoRow(reopened, rowId).getByTestId('trim-preparing');
    await expect(preparing).toHaveText('Preparing');
    await expect
      .poll(
        async () => {
          const [row] = await items(reopened, playlistId);
          return row?.kind === 'media' && row.id === rowId && row.mediaId !== mediaId;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(preparing).toHaveCount(0);
    expect(await preparingRows()).toEqual([]);
    expect(
      await reopened.evaluate((id) => (globalThis as PageGlobals).drashti.media.rowTrim(id), rowId),
    ).toMatchObject({ sourceId: mediaId, markers: points });
    expect(stamp(file)).toEqual(before);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
