import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
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
 * Parts of one video joined into one exported clip (alpha.24; the owner, 27 Nov 2026: "one video can be cut in 2 parts
 * and merged, for example a 30 minute video, i want from 0 to 10 and 20 to 30 but in 1 video"). Only a generated
 * video: red for its first two seconds, green for the next two, blue for the last two, with a steady tone throughout.
 */

interface ExportJob {
  id: string;
  state: string;
  path: string | null;
  added: boolean;
  message: string | null;
}
interface ExportGlobals {
  drashti: { media: { clipExports(): Promise<ExportJob[]> } };
}

function ffmpeg(args: string[]) {
  const file = testFfmpeg();
  if (!file) throw new Error('The bundled FFmpeg is required.');
  return spawnSync(file, ['-hide_banner', '-nostdin', '-y', '-threads', '1', ...args], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function colours(file: string) {
  const made = ffmpeg([
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=25:d=6',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:r=48000:d=6',
    '-vf',
    "drawbox=color=lime:t=fill:enable='gte(t,2)',drawbox=color=blue:t=fill:enable='gte(t,4)'",
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '50',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    file,
  ]);
  expect(made.status, made.stderr.toString()).toBe(0);
  return file;
}

const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The colour of the clip's frame number `n` (from 0), as one averaged RGB pixel. */
function frame(file: string, n: number): number[] {
  const read = ffmpeg([
    '-loglevel',
    'error',
    '-i',
    file,
    '-map',
    '0:V:0',
    '-vf',
    `select=eq(n\\,${String(n)}),scale=1:1`,
    '-frames:v',
    '1',
    '-fps_mode',
    'passthrough',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  expect(read.status, read.stderr.toString()).toBe(0);
  return [...read.stdout];
}
const isRed = ([r = 0, g = 0, b = 0]: number[]) => r > 190 && g < 70 && b < 70;
const isGreen = ([r = 0, g = 0, b = 0]: number[]) => g > 190 && r < 70 && b < 70;
const isBlue = ([r = 0, g = 0, b = 0]: number[]) => b > 190 && r < 70 && g < 70;

/** How long one of the clip's streams lasts, as FFmpeg reads it to its end (the last time= it reports). */
function streamSeconds(file: string, stream: '0:V:0' | '0:a:0'): number {
  const read = ffmpeg(['-loglevel', 'info', '-stats', '-i', file, '-map', stream, '-f', 'null', '-']);
  expect(read.status, read.stderr.toString()).toBe(0);
  const times = [...read.stderr.toString().matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/gu)];
  const last = times.at(-1);
  if (!last) throw new Error(`FFmpeg said no time for ${stream}.`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

async function open(win: Page, name: string) {
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await win.getByTestId('media-item').filter({ hasText: name }).click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Edit Video…', exact: true }).click();
  const dialog = win.getByTestId('edit-video');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.getByTestId('edit-video-preview').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  return dialog;
}

test('Edit Video…: two parts of one video, typed as seconds and as m:ss, exported as one clip with picture and sound throughout', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    const dir = mkdtempSync(join(tmpdir(), 'drashti-edit-video-parts-'));
    const source = colours(join(dir, 'Placeholder parts.mp4'));
    const sha = hash(source);
    const [id = ''] = await importAndGetIds(win, [source]);
    expect(id).not.toBe('');
    const managed = join(userData, 'Media', sha.slice(0, 2), `${sha}.mp4`);
    expect(hash(managed)).toBe(sha);
    const destination = join(dir, 'Placeholder joined.mp4');
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, destination);

    const dialog = await open(win, 'Placeholder parts');
    const start = dialog.getByLabel('Start (seconds)', { exact: true });
    const end = dialog.getByLabel('End (seconds)', { exact: true });
    // The video's length supplies End's first time (about 6 s): let it arrive before typing.
    await expect(end).not.toHaveValue('0');
    const length = await end.inputValue();
    expect(Math.abs(Number(length) - 6), `End shows ${length}`).toBeLessThanOrEqual(0.1);
    await expect(start).toHaveValue('0');
    // Part 1: seconds, as before, and a minutes-and-seconds time.
    await start.fill('0.5');
    await end.fill('0:01.500');
    await dialog.getByRole('button', { name: 'Add a part', exact: true }).click();
    const partStart = dialog.getByLabel('Part 2 start', { exact: true });
    const partEnd = dialog.getByLabel('Part 2 end', { exact: true });
    // A new part starts where the last one ends, and runs to the video's end.
    await expect(partStart).toHaveValue('1.5');
    await expect(partEnd).toHaveValue(length);
    const check = dialog.getByTestId('clip-parts-check');
    // An overlap is refused in words, never changed to fit.
    await partStart.fill('1');
    await expect(check).toHaveText('Parts 1 and 2 overlap. Make each part end before the next one starts.');
    await expect(partStart).toHaveValue('1');
    // Words that are not a time are refused too.
    await partEnd.fill('soon');
    await expect(
      dialog.getByText('Type seconds, such as 600, or a time, such as 10:00 or 1:20:00.'),
    ).toBeVisible();
    await expect(check).toHaveText(
      'Part 2: type its start and end as seconds, such as 600, or as a time, such as 10:00.',
    );
    await partStart.fill('0:04');
    await partEnd.fill('5.5');
    await expect(check).toHaveText(
      'Export clip… joins 2 parts, in time order: 0:00.500 to 0:01.500, then 0:04 to 0:05.500. The new video is 0:02.500 long.',
    );
    await expectFits(dialog, 'Edit Video with a second part at the CI operator size');
    await expectNoSeriousA11yIssues(win, 'Edit Video’s Trim with a second part');

    await dialog.getByRole('button', { name: 'Preparation and export', exact: true }).click();
    const exportButton = dialog.getByRole('button', { name: 'Export clip…', exact: true });
    // Saved edits cover Start and End only: joined parts take the original picture and sound.
    await expect(dialog.getByLabel('Picture and sound')).toHaveValue('edited');
    await expect(
      dialog.getByText(
        'Joined parts use the original picture and sound. Choose Original under Picture and sound.',
      ),
    ).toBeVisible();
    await expect(exportButton).toBeDisabled();
    await dialog.getByLabel('Picture and sound').selectOption('original');
    await expect(dialog.getByTestId('clip-parts-export')).toHaveText(
      'Export clip… joins 2 parts, in time order: 0:00.500 to 0:01.500, then 0:04 to 0:05.500. The new video is 0:02.500 long.',
    );
    await dialog.getByLabel('Also add the clip to Media').check();
    await expectNoSeriousA11yIssues(win, 'Edit Video’s export of two parts');
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    await expect
      .poll(
        async () => {
          const jobs = await win.evaluate(() =>
            (globalThis as unknown as ExportGlobals).drashti.media.clipExports(),
          );
          const job = jobs.at(-1);
          if (job?.state === 'failed' || job?.state === 'stopped')
            throw new Error(job.message ?? `The export ${job.state}.`);
          return job?.state;
        },
        { timeout: 90_000 },
      )
      .toBe('done');
    const jobs = await win.evaluate(() =>
      (globalThis as unknown as ExportGlobals).drashti.media.clipExports(),
    );
    expect(jobs.at(-1)).toMatchObject({ path: destination, added: true });
    await expect(dialog.locator('[data-testid="clip-export-job"][data-state="done"]')).toBeVisible();
    expect(existsSync(destination)).toBe(true);

    // One video: the parts' lengths added up, its picture and its sound lasting as long as each other.
    const picture = streamSeconds(destination, '0:V:0');
    const sound = streamSeconds(destination, '0:a:0');
    await test.info().attach('The joined clip', {
      body: JSON.stringify({ picture, sound, read: ffmpeg(['-i', destination]).stderr.toString() }, null, 2),
      contentType: 'application/json',
    });
    expect(Math.abs(picture - 2.5), `its picture lasts ${String(picture)} s`).toBeLessThanOrEqual(0.1);
    expect(Math.abs(sound - 2.5), `its sound lasts ${String(sound)} s`).toBeLessThanOrEqual(0.1);
    // Within a frame or two (25 a second): the joins pad neither one alone.
    expect(Math.abs(picture - sound), 'its picture and sound stay together').toBeLessThanOrEqual(0.08);
    // Part 1 is red (from 0.5 s) to its last frame; part 2's first frame is the source's at 4 s: blue, not the green
    // just before it. 25 frames a second: part 1 is 25 frames.
    expect(isRed(frame(destination, 0)), 'part 1’s first frame').toBe(true);
    expect(isRed(frame(destination, 24)), 'part 1’s last frame').toBe(true);
    const seam = frame(destination, 25);
    expect(isBlue(seam), `part 2’s first frame is ${JSON.stringify(seam)}`).toBe(true);
    expect(isGreen(seam)).toBe(false);
    expect(isBlue(frame(destination, 61)), 'part 2’s last frame').toBe(true);
    // The tone throughout: no silence anywhere in it, the join included.
    const quiet = ffmpeg([
      '-loglevel',
      'info',
      '-i',
      destination,
      '-map',
      '0:a:0',
      '-af',
      'silencedetect=n=-40dB:d=0.1',
      '-f',
      'null',
      '-',
    ]);
    expect(quiet.status, quiet.stderr.toString()).toBe(0);
    expect(quiet.stderr.toString()).not.toMatch(/silence_start/u);

    // In Media as one video of its own; the original is never replaced.
    const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    expect(media.filter((m) => m.kind === 'video').map((m) => m.name)).toEqual(
      expect.arrayContaining(['Placeholder parts.mp4', 'Placeholder joined.mp4']),
    );
    expect(hash(source)).toBe(sha);
    expect(hash(managed)).toBe(sha);
  } finally {
    await app.close();
  }
});
