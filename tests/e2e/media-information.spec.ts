import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  openSection,
  operatorPage,
  operatorReady,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Media information… (alpha.20: the owner's Q60-34 item 1, and his "Yes, all A" to Q60-39): right-click a video or a
 * sound wherever it shows (Media, a playlist's row, an audio playlist's track; Simple Mode's rows too) and a small
 * window says what the file holds, as the bundled FFmpeg reads it: its container, length and size; each picture's
 * codec, profile and level, bit depth and colour, size and shape, frame rate and scan; each sound track's codec,
 * sample rate, channels and language; a cover picture; and how Drashti plays it. It only reads: what is up carries
 * on exactly as it was. Generated media only (FFmpeg's test sources, made here), placeholder names.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): string {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return args.at(-1) ?? '';
}

/**
 * 4 s of H.264 (High, level 3.1) at 320 × 180, 25 a second, in Matroska (which keeps a track's own name), with two
 * sound tracks: AAC stereo at 48 kHz in English, then AAC mono in Gujarati, named "Placeholder commentary".
 */
const twoTracks = (file: string) =>
  ff([
    ...['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=4'],
    ...['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=4'],
    ...['-f', 'lavfi', '-i', 'sine=f=880:r=48000:d=4'],
    ...['-map', '0:v', '-map', '1:a', '-map', '2:a'],
    // veryfast keeps what makes it High (ultrafast would leave it Constrained Baseline).
    ...[
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-profile:v',
      'high',
      '-level',
      '3.1',
      '-pix_fmt',
      'yuv420p',
    ],
    ...['-c:a', 'aac', '-ac:a:0', '2', '-ac:a:1', '1', '-ar', '48000'],
    ...['-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=guj'],
    ...['-metadata:s:a:1', 'title=Placeholder commentary', '-shortest', file],
  ]);

/** 3 s of interlaced H.264 (top field first) at 720 × 576, its pixels shaped for a 16:9 picture. No sound. */
const interlaced = (file: string) =>
  ff([
    ...['-f', 'lavfi', '-i', 'testsrc2=s=720x576:r=25:d=3', '-vf', 'setsar=64/45'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    ...['-flags', '+ildct+ilme', '-x264-params', 'tff=1', file],
  ]);

/**
 * 3 s of progressive H.264 at 720 × 576, its pixels shaped for a 16:9 picture (alpha.20's "Plays anything" converts an
 * interlaced one by itself, so a playlist's row of one soon plays its progressive copy).
 */
const widePixels = (file: string) =>
  ff([
    ...['-f', 'lavfi', '-i', 'testsrc2=s=720x576:r=25:d=3', '-vf', 'setsar=64/45'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file],
  ]);

/** 3 s of an MP3 (44.1 kHz, mono) with a 32 × 32 JPEG cover picture (the picture made first, then put in whole). */
function withCover(file: string): string {
  const cover = ff(['-f', 'lavfi', '-i', 'color=c=0x3a6ea5:s=32x32:d=1', '-frames:v', '1', `${file}.jpg`]);
  return ff([
    ...['-f', 'lavfi', '-i', 'sine=f=660:r=44100:d=3', '-i', cover],
    ...['-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1'],
    ...['-c:v', 'copy', '-disposition:v', 'attached_pic', '-id3v2_version', '3', file],
  ]);
}

async function start(): Promise<{ app: ElectronApplication; win: Page; dir: string }> {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  return { app, win, dir: mkdtempSync(join(tmpdir(), 'drashti-media-info-')) };
}

/** The window, opened from a row's right-click menu. */
async function openFrom(win: Page, row: Locator): Promise<Locator> {
  await row.click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Media information…' }).click();
  const dialog = win.getByTestId('media-info');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** One line of one part of the window: its words, as shown. */
const line = (dialog: Locator, part: string, label: string): Locator =>
  dialog.getByRole('region', { name: part, exact: true }).locator(`[data-label="${label}"] dd`);

const dispatch = (win: Page, command: unknown) =>
  win.evaluate(
    (c) =>
      (globalThis as PageGlobals).drashti.engine.dispatch(
        c as Parameters<PageGlobals['drashti']['engine']['dispatch']>[0],
      ),
    command,
  );

/** What the background plays, as the engine has it: its file, when it started, and any move or pause. */
const background = (win: Page) =>
  win.evaluate(async () => {
    const { state } = await (globalThis as PageGlobals).drashti.engine.snapshot();
    const bg = state.layers.background;
    return bg?.kind === 'media'
      ? { mediaId: bg.mediaId, startedAt: bg.startedAt, seek: bg.seek ?? null }
      : null;
  });

test('Media: a video’s container, length, size, its picture and both its sound tracks, Copy; what is up carries on', async () => {
  test.setTimeout(180_000);
  const { app, win, dir } = await start();
  const [id = ''] = await importAndGetIds(win, [twoTracks(join(dir, 'Placeholder two tracks.mkv'))]);
  expect(id).not.toBe('');
  // Up as the background while its information is read: nothing about it may change.
  const put = await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
  });
  expect(put.ok).toBe(true);
  const before = await background(win);
  expect(before?.mediaId).toBe(id);

  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  const dialog = await openFrom(
    win,
    win.getByTestId('media-item').filter({ hasText: 'Placeholder two tracks' }),
  );
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
    'Media information: Placeholder two tracks.mkv',
  );
  // The file.
  await expect(line(dialog, 'The file', 'What it is')).toHaveText('Video');
  await expect(line(dialog, 'The file', 'Container')).toHaveText('Matroska');
  await expect(line(dialog, 'The file', 'Length')).toHaveText('0:04');
  await expect(line(dialog, 'The file', 'Size')).toHaveText(/^\d+(\.\d)? (KB|MB)$/u);
  // Its picture.
  await expect(line(dialog, 'Picture', 'Codec')).toHaveText('H.264');
  await expect(line(dialog, 'Picture', 'Profile')).toHaveText('High, level 3.1');
  await expect(line(dialog, 'Picture', 'Bit depth')).toHaveText('8-bit');
  await expect(line(dialog, 'Picture', 'Colour')).toHaveText('4:2:0');
  await expect(line(dialog, 'Picture', 'Size')).toHaveText('320 × 180 (16:9)');
  await expect(line(dialog, 'Picture', 'Frame rate')).toHaveText('25 a second');
  await expect(line(dialog, 'Picture', 'Scan')).toHaveText('Progressive');
  // Its two sound tracks: the first is the one Drashti plays.
  await expect(line(dialog, 'Sound 1 of 2', 'Codec')).toHaveText('AAC');
  await expect(line(dialog, 'Sound 1 of 2', 'Profile')).toHaveText('LC');
  await expect(line(dialog, 'Sound 1 of 2', 'Sample rate')).toHaveText('48 kHz');
  await expect(line(dialog, 'Sound 1 of 2', 'Channels')).toHaveText('Stereo');
  await expect(line(dialog, 'Sound 1 of 2', 'Language')).toHaveText('English');
  await expect(line(dialog, 'Sound 1 of 2', 'Played')).toHaveText('Yes');
  await expect(line(dialog, 'Sound 2 of 2', 'Channels')).toHaveText('Mono');
  await expect(line(dialog, 'Sound 2 of 2', 'Language')).toHaveText('Gujarati');
  await expect(line(dialog, 'Sound 2 of 2', 'Title')).toHaveText('Placeholder commentary');
  await expect(line(dialog, 'Sound 2 of 2', 'Played')).toHaveText('No: Drashti plays the first');
  // How Drashti plays it.
  await expect(line(dialog, 'In Drashti', 'Plays')).toHaveText('As it is');
  await expect(line(dialog, 'In Drashti', 'Start and end')).toHaveText('The whole file');
  await expectNoSeriousA11yIssues(win, 'Media information at 1024 × 645');

  // Copy: the window's words, for a message or a problem report.
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toContain('Media information: Placeholder two tracks.mkv');
  expect(copied).toContain('Codec: H.264');
  expect(copied).toContain('Language: Gujarati');

  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // It only read the file: the background plays on, from the same start, never moved or paused.
  expect(await background(win)).toEqual(before);
});

test('a playlist’s row and an audio playlist’s track: pixels shaped 16:9, an interlaced file’s own scan, an MP3 with its cover; Simple Mode’s rows too', async () => {
  test.setTimeout(180_000);
  const { win, dir } = await start();
  const [videoId = '', soundId = ''] = await importAndGetIds(win, [
    widePixels(join(dir, 'Placeholder wide pixels.mp4')),
    withCover(join(dir, 'Placeholder cover.mp3')),
    interlaced(join(dir, 'Placeholder interlaced.mp4')),
  ]);
  expect(videoId).not.toBe('');
  expect(soundId).not.toBe('');
  const made = await win.evaluate(
    async ({ videoId, soundId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const playlist = await d.playlists.create('Placeholder information sabha', null, false);
      if (!playlist.ok) return playlist.message;
      const added = await d.playlists.addItems(playlist.ids[0] ?? '', null, [
        { kind: 'media', mediaId: videoId },
      ]);
      if (!added.ok) return added.message;
      const music = await d.music.create('Placeholder music');
      if (!music.ok) return music.message;
      const tracks = await d.music.addTracks(music.id ?? '', [soundId], null);
      return tracks.ok ? 'ok' : tracks.message;
    },
    { videoId, soundId },
  );
  expect(made).toBe('ok');

  // A playlist's row.
  await win.getByTestId('playlist-node').filter({ hasText: 'Placeholder information sabha' }).click();
  const row = win.getByTestId('playlist-item').filter({ hasText: 'Placeholder wide pixels' });
  let dialog = await openFrom(win, row);
  await expect(line(dialog, 'Picture', 'Size')).toHaveText('720 × 576, shown as 16:9');
  await expect(line(dialog, 'Picture', 'Scan')).toHaveText('Progressive');
  await expect(dialog.getByRole('region', { name: 'Sound', exact: true })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // An audio playlist's track.
  await openSection(win, 'audio');
  await win.getByTestId('music-playlist').filter({ hasText: 'Placeholder music' }).click();
  dialog = await openFrom(win, win.getByTestId('music-track').filter({ hasText: 'Placeholder cover' }));
  await expect(line(dialog, 'The file', 'What it is')).toHaveText('Sound');
  await expect(line(dialog, 'The file', 'Container')).toHaveText('MP3');
  await expect(line(dialog, 'Sound', 'Codec')).toHaveText('MP3');
  await expect(line(dialog, 'Sound', 'Sample rate')).toHaveText('44.1 kHz');
  await expect(line(dialog, 'Sound', 'Channels')).toHaveText('Mono');
  await expect(line(dialog, 'Cover picture', 'Picture')).toHaveText('JPEG, 32 × 32');
  await expect(dialog.getByRole('region', { name: 'Picture', exact: true })).toHaveCount(0);
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // An interlaced file's own window says so: its original in Media, which keeps a row of its own (saying what it
  // became) once it is converted by itself to a progressive copy of the same name (alpha.20, "Plays anything").
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  const original = win
    .getByTestId('media-row')
    .filter({ hasText: 'Placeholder interlaced' })
    .filter({ has: win.getByTestId('media-note').filter({ hasText: 'Converted to .mp4' }) });
  await expect(original).toHaveCount(1, { timeout: 60_000 });
  dialog = await openFrom(win, original.getByTestId('media-item'));
  await expect(line(dialog, 'Picture', 'Scan')).toHaveText('Interlaced, top field first');
  await expect(line(dialog, 'Picture', 'Size')).toHaveText('720 × 576, shown as 16:9');
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await closeLibrary(win);

  // Simple Mode's rows have it too (Q60-39, P6 (j): "Yes, all A").
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  dialog = await openFrom(
    win,
    simple.getByTestId('playlist-item').filter({ hasText: 'Placeholder wide pixels' }),
  );
  await expect(line(dialog, 'Picture', 'Codec')).toHaveText('H.264');
  await expectNoSeriousA11yIssues(win, 'Media information in Simple Mode');
});
