import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { testFfmpeg } from './stream-helpers';
import { dispatch, row } from './time-bar-helpers';

/*
 * Snapshot (alpha.20: the owner's Q60-34 items, his "Yes, all A" to Q60-39 P6 (d) A): the time bar's ⋯ › Snapshot
 * makes the frame on the screens, full size, from the file itself (FFmpeg below normal priority; nothing on the screens
 * is touched), a PNG in Media named "<video> at 0m03s", with Undo. Generated media only: a video whose every second is
 * one colour, paused at 3.2 s, gives a picture of second 3's colour.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

/** Each second's colour (RGB). */
const COLOURS = [
  [0xd0, 0x30, 0x30],
  [0x30, 0xa0, 0x30],
  [0x30, 0x50, 0xd0],
  [0xd0, 0xc0, 0x30],
  [0xc0, 0x40, 0xc0],
] as const;

const hex = (c: readonly number[]) => `0x${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function ff(args: string[]): Buffer {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

/** Five seconds, each one colour, 320 × 180 at 25 a second. */
function colours(file: string): string {
  ff([
    ...COLOURS.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${hex(c)}:s=320x180:r=25:d=1`]),
    ...['-filter_complex', `${COLOURS.map((_, i) => `[${String(i)}:v]`).join('')}concat=n=5:v=1:a=0[v]`],
    ...['-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file],
  ]);
  return file;
}

/** A picture file's pixels as RGB, read by FFmpeg: its size and its middle pixel. */
function pixelsOf(file: string): { bytes: number; middle: number[] } {
  const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const middle = (90 * 320 + 160) * 3;
  return { bytes: raw.length, middle: [...raw.subarray(middle, middle + 3)] };
}

/** Every PNG in the library's media folder. */
function pngsIn(mediaDir: string): string[] {
  return readdirSync(mediaDir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.png'))
    .map((f) => join(mediaDir, f));
}

const listMedia = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());

test('Snapshot from the time bar’s ⋯: the frame shown, full size, a PNG in Media named for its place, with Undo', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-snapshot-'));
    const [mediaId = ''] = await importAndGetIds(win, [colours(join(dir, 'Placeholder colours.mp4'))]);
    expect(mediaId).not.toBe('');
    const before = pngsIn(join(userData, 'Media'));
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId, media: 'video', fit: 'fit', loop: false },
        })
      ).ok,
    ).toBe(true);
    const bg = row(win, 'background');
    await expect(bg.getByRole('slider', { name: 'Time of the background video', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } })).ok).toBe(true);
    expect((await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 3200 })).ok).toBe(
      true,
    );

    await bg.getByRole('button', { name: 'More for Background' }).click();
    await win.getByRole('menuitem', { name: 'Snapshot' }).click();
    // A picture in Media, named for the video and its place.
    await expect
      .poll(async () => (await listMedia(win)).find((m) => m.kind === 'image')?.name ?? null, {
        timeout: 30_000,
      })
      .toBe('Placeholder colours at 0m03s.png');
    const made = pngsIn(join(userData, 'Media')).filter((f) => !before.includes(f));
    expect(made).toHaveLength(1);
    const { bytes, middle } = pixelsOf(made[0] ?? '');
    // Full size (320 × 180), and second 3's colour (within what the video's own colour coding moves it).
    expect(bytes).toBe(320 * 180 * 3);
    const want = COLOURS[3];
    for (const [i, v] of middle.entries())
      expect(Math.abs(v - (want[i] ?? 0)), `channel ${String(i)}`).toBeLessThan(16);
    // Nothing on the screens changed: the video waits where it was.
    const still = (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state
      .layers.background;
    expect(still?.kind === 'media' ? { id: still.mediaId, seek: still.seek?.toMs } : null).toEqual({
      id: mediaId,
      seek: 3200,
    });

    // Undo takes it away again.
    await win.getByTestId('undo-removal').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await listMedia(win)).some((m) => m.kind === 'image')).toBe(false);
  } finally {
    await app.close();
  }
});
