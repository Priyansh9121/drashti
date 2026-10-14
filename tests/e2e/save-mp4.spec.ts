import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * A video's start and end on a timeline, and Save as MP4… (Session 26e): a
 * placeholder video (FFmpeg's test pattern, a keyframe every second, turned
 * a quarter round) trimmed in the dialog and saved, then looked at with
 * FFmpeg: the same codecs, size, frame rate and bit rate; its packets the
 * original's (copied, not made again); beginning at the keyframe the
 * dialog named; as long as asked within one keyframe's interval. The
 * original file is never changed, and nothing is saved over a file there.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg, 'needs the bundled FFmpeg (pnpm fetch-ffmpeg)');

const run = (args: string[]) => spawnSync(ffmpeg ?? '', ['-hide_banner', ...args]);
/** What FFmpeg says a file holds. */
const said = (file: string) => run(['-i', file]).stderr.toString();
/** A file's video packets as FFmpeg hashes them (copied, not decoded). */
const packets = (file: string) =>
  run(['-loglevel', 'error', '-i', file, '-map', '0:v', '-c', 'copy', '-f', 'framemd5', '-'])
    .stdout.toString()
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.split(',').at(-1)?.trim() ?? '');
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('a video trimmed on its timeline and saved as an MP4, copied as it is from the clean frame the dialog names', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-save-mp4-'));
  const plain = join(dir, 'plain.mp4');
  const source = join(dir, 'Placeholder Katha.mp4');
  expect(
    run([
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=320x180:r=25',
      '-f',
      'lavfi',
      '-i',
      'sine=r=48000:f=440',
      '-t',
      '10',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '25',
      '-keyint_min',
      '25',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '600k',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      plain,
    ]).status,
  ).toBe(0);
  // Turned a quarter round (as a phone's video is): the turn must be kept.
  expect(
    run(['-loglevel', 'error', '-y', '-display_rotation', '90', '-i', plain, '-c', 'copy', source]).status,
  ).toBe(0);
  const out = join(dir, 'Saved');
  mkdirSync(out);
  const saveAs = join(out, 'Placeholder Katha (0m 04s).mp4');

  const sourceSha = sha(source);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 720 });
  const [mediaId = ''] = await importAndGetIds(win, [source]);
  const stored = await win.evaluate(
    async (id) => (globalThis as PageGlobals).drashti.media.markers(id),
    mediaId,
  );
  expect(stored).toMatchObject({ startMs: null, endMs: null });
  const before = (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).length;

  // The timeline, from the video's row in Media.
  await win.getByRole('tab', { name: 'Media' }).click();
  await win.getByTestId('media-markers').first().click();
  const dialog = win.getByTestId('markers-dialog');
  await expect(dialog.getByTestId('timeline')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByTestId('markers-length')).toHaveText('0:10 → 0:10');
  await dialog.getByTestId('markers-start').fill('0:02.4');
  await dialog.getByTestId('markers-end').fill('0:06.0');
  await expect(dialog.getByTestId('markers-length')).toHaveText('0:10 → 0:03');
  // The clean frame it will begin at, shown before saving.
  await expect(dialog.getByTestId('markers-keyframe')).toContainText(
    'Saved from 0:02.0, the nearest clean frame.',
    {
      timeout: 20_000,
    },
  );
  await expect(dialog.getByTestId('timeline-keyframe')).toHaveCount(1);
  // The handles move with the keys too.
  await dialog.getByTestId('timeline-end').focus();
  await win.keyboard.press('ArrowRight');
  await expect(dialog.getByTestId('markers-end')).toHaveValue('0:06.1');
  await win.keyboard.press('ArrowLeft');
  await expect(dialog.getByTestId('markers-end')).toHaveValue('0:06.0');

  await app.evaluate(({ dialog: d }, path) => {
    d.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, saveAs);
  await dialog.getByTestId('markers-save-mp4').click();
  await expect(dialog.getByTestId('markers-save-state')).toHaveAttribute('data-state', 'done', {
    timeout: 60_000,
  });
  await expect(win.getByTestId('save-result')).toContainText('Saved “Placeholder Katha (0m 04s).mp4”');

  // FFmpeg's look at it: the same codecs, size, frame rate and bit rate, the turn kept, starting as it downloads.
  const was = said(source);
  const now = said(saveAs);
  for (const part of [/Video: h264/u, /320x180/u, /25 fps/u, /Audio: aac/u, /rotation of 90\.00 degrees/u])
    expect(now, String(part)).toMatch(part);
  const rate = (text: string) => Number(/Video: h264.*?, (\d+) kb\/s/u.exec(text)?.[1] ?? 0);
  expect(Math.abs(rate(now) - rate(was))).toBeLessThan(rate(was) * 0.15);
  // Its packets are the original's from the keyframe at 2 s, byte for byte: copied, not made again.
  const part = packets(saveAs);
  expect(part.length).toBeGreaterThanOrEqual(99);
  expect(packets(source).slice(50, 50 + part.length)).toEqual(part);
  // As long as asked (3.6 s) within one keyframe interval (1 s): from 0:02.0 to 0:06.0.
  const length = Number(/Duration: 00:00:(\d+\.\d+)/u.exec(now)?.[1] ?? 0);
  expect(Math.abs(length - 3.6)).toBeLessThanOrEqual(1);
  expect(Math.abs(length - 4)).toBeLessThan(0.15);
  // moov before mdat: it plays as it downloads.
  const head = readFileSync(saveAs).subarray(0, 4096).toString('latin1');
  expect(head.indexOf('moov')).toBeGreaterThan(0);
  if (head.includes('mdat')) expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat'));

  // Saved again where that file is: never over it. Not added to the library, as it was not ticked.
  await dialog.getByTestId('markers-save-mp4').click();
  await expect(dialog.getByTestId('markers-save-state')).toContainText(
    'Saved “Placeholder Katha (0m 04s) (2).mp4”.',
    { timeout: 60_000 },
  );
  expect(readdirSync(out).sort()).toEqual([
    'Placeholder Katha (0m 04s) (2).mp4',
    'Placeholder Katha (0m 04s).mp4',
  ]);
  expect((await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).length).toBe(
    before,
  );

  // Ticked: the saved part goes into the library too.
  await dialog.getByTestId('markers-add-to-library').check();
  await dialog.getByTestId('markers-save-mp4').click();
  await expect(dialog.getByTestId('markers-save-state')).toContainText('and added to the library', {
    timeout: 60_000,
  });
  await expect
    .poll(
      async () => (await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia())).length,
    )
    .toBe(before + 1);

  // The library's file it came from is never changed (it is named by its bytes); its start and end are
  // kept only when the dialog's Save keeps them.
  expect(sha(join(userData, 'Media', sourceSha.slice(0, 2), `${sourceSha}.mp4`))).toBe(sourceSha);
  const original = await win.evaluate(
    async (id) => (globalThis as PageGlobals).drashti.media.markers(id),
    mediaId,
  );
  expect(original).toMatchObject({ startMs: null, endMs: null });
  await app.close();
});
