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
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

function ffmpeg(args: string[], input?: Buffer) {
  const path = testFfmpeg();
  if (!path) throw new Error('This test needs Drashti’s bundled FFmpeg.');
  const result = spawnSync(path, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { input });
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
    const legacyPoints = { startMs: 400, endMs: 5500 };
    const marked = await win.evaluate(
      ({ mediaId, legacyPoints }) =>
        (globalThis as PageGlobals).drashti.media.setMarkers(mediaId, { ...legacyPoints, markers: [] }),
      { mediaId, legacyPoints },
    );
    expect(marked.ok).toBe(true);
    const sha = sourceBefore.sha256;
    const original = join(userData, 'Media', sha.slice(0, 2), `${sha}.mp4`);
    const originalBefore = stamp(original);
    const cut = join(dirname(original), 'Placeholder numbered trimmed.mp4');
    const playlistName = 'Placeholder trim playlist';
    const { edited, other } = await win.evaluate(
      async ({ mediaId, playlistName }) => {
        const d = (globalThis as PageGlobals).drashti;
        const make = async (name: string) => {
          const made = await d.playlists.create(name, null, false);
          if (!made.ok) throw new Error(made.message);
          const playlistId = made.ids[0] ?? '';
          const added = await d.playlists.addItems(playlistId, null, [{ kind: 'media', mediaId }]);
          if (!added.ok) throw new Error(added.message);
          return { playlistId, rowId: added.ids[0] ?? '' };
        };
        const edited = await make(playlistName);
        const set = await d.playlists.setWhenEnds(edited.rowId, 'freeze');
        if (!set.ok) throw new Error(set.message);
        return { edited, other: await make('Placeholder other playlist') };
      },
      { mediaId, playlistName },
    );
    await win.getByTestId('playlist-node').filter({ hasText: playlistName }).click();
    const row = win.getByTestId('playlist-item').and(win.locator(`[data-item-id="${edited.rowId}"]`));
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
    await saveCut('0:01.4', '0:04.6');
    await expect(preparing).toHaveText('Preparing');
    await holdStill(() => !existsSync(cut), 2200, 'the stream is on air');
    expect(await items(win, edited.playlistId)).toMatchObject([{ id: edited.rowId, mediaId }]);

    // The pending row can go live using the original. Taking the stream off air alone does not release the cut.
    await row.click();
    await expect
      .poll(() =>
        win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
        ),
      )
      .toMatchObject({ kind: 'media', mediaId });
    await onAir(app, false);
    await holdStill(() => !existsSync(cut), 2200, 'the original is still live');
    await expect(preparing).toHaveText('Preparing');
    await win.getByRole('button', { name: 'Clear all' }).click();

    await expect(name).toHaveText('Placeholder numbered trimmed', { timeout: 30_000 });
    await expect(preparing).toHaveCount(0);
    const [first] = await items(win, edited.playlistId);
    if (first?.kind !== 'media') throw new Error('The trimmed video is missing from its playlist.');
    expect(first).toMatchObject({ id: edited.rowId, whenEnds: 'freeze' });
    expect(first.mediaId).not.toBe(mediaId);
    expect(framesOf(cut)).toEqual(Array.from({ length: 80 }, (_, i) => 35 + i));

    await row.click();
    await expect
      .poll(() =>
        win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
        ),
      )
      .toMatchObject({ kind: 'media', mediaId: first.mediaId });
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
    const background = () =>
      win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
      );
    await row.click();
    await expect.poll(background).toMatchObject({ kind: 'media', mediaId });
    expect(await background()).not.toHaveProperty('clip');
    await win.getByRole('button', { name: 'Clear all' }).click();
    await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder other playlist' }).click();
    await win
      .getByTestId('playlist-item')
      .and(win.locator(`[data-item-id="${other.rowId}"]`))
      .click();
    await expect.poll(background).toMatchObject({ kind: 'media', mediaId, clip: legacyPoints });
    expect(stamp(source)).toEqual(sourceBefore);
    expect(stamp(original)).toEqual(originalBefore);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
