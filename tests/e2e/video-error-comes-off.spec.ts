import { expect, test } from '@playwright/test';
import {
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  dispatch,
  failVideo,
  installLooks,
  LIVE,
  makeClip,
  notices,
  openNewPlaylist,
  OUT,
  pictureUp,
  row,
  SCREENS,
  shown,
  soundPlays,
  wallpaperAndPicture,
  watch,
} from './hall-looks';
import { testFfmpeg } from './stream-helpers';

/*
 * A video whose element fails on a screen (Q60-31, the owner's own bug: "the video where it doesnt play in audience
 * screen"; his video, an ordinary H.264 file, played on his laptop and not on the mandir's Mac, its sound playing while
 * LIVE showed black or the Wallpaper). x46's hunt (CI x46-1120-112649-63694) showed what Drashti did on every computer
 * when a screen's video element fails, as that computer's decoder raises an error, or a cut or damaged file does: the
 * hall went BLACK at once (the picture before dropped), its sound playing on, never taken off, nobody told (only LIVE's
 * own mark when LIVE's element failed too; with the hall's alone, LIVE showed the video playing). As x36's reaction to a
 * picture that cannot be drawn: it comes off at once with its sound, the hall never black, a notice naming the file
 * and the screen, and the log naming the error's kind and the screen. Generated media only, placeholder names.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

/** Everything this Drashti wrote to its log (logs/drashti.log, then drashti.1.log… as it fills). */
function logOf(userData: string): string {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/** Bytes from 40 % to 60 % of the file written over with made-up noise (always the same), as a damaged disk would. */
function damageMiddle(path: string): string {
  const size = statSync(path).size;
  const from = Math.floor(size * 0.4);
  const junk = Buffer.alloc(Math.floor(size * 0.6) - from);
  let x = 12345;
  for (let i = 0; i < junk.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    junk[i] = x & 0xff;
  }
  const fd = openSync(path, 'r+');
  try {
    writeSync(fd, junk, 0, junk.length, from);
  } finally {
    closeSync(fd);
  }
  return path;
}

test('a video whose element fails while it plays on a hall screen (as that computer’s decoder raises an error), LIVE still playing it: it comes off at once with its sound, the hall never black, a notice names the file and the screen, and the log the error’s kind and the screen', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-error-'));
  const clip = makeClip(join(dir, 'Placeholder fails on the hall.mp4'), 'h264', 20, 300);
  const { app, userData } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    expect(hall.name, 'the audience screen’s name').not.toBe('');
    const beforeId = await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    const { item } = await openNewPlaylist(win, 'Placeholder video error', id);
    await installLooks(hall.page, OUT);
    await pictureUp(win, hall.page, beforeId);
    await row(win, item).click();
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000, message: 'it plays' }).toBe('VIDEO');
    await letTimePass(win, 1000, 'it plays a moment before the hall’s decoder fails');
    expect(await failVideo(hall.page, id), 'the hall’s video element').toBe(true);
    // Only the hall's element failed: LIVE's plays on. Main must hear it from the hall.
    const w = await watch(app, win, hall.page, id, 6_000, false);
    expect(w.off, `it came off within 6 s of the error: ${w.looks.join(' | ')}`).toBe(true);
    expect(w.blackWithSound, `never black while its sound played: ${w.looks.join(' | ')}`).toBe(0);
    expect(w.black, `never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
    await expect
      .poll(() => soundPlays(app), { timeout: 5_000, message: 'its sound stopped with it' })
      .toBe(false);
    // Off: the Wallpaper on the hall and on LIVE alike (LIVE never says it plays while the hall does not).
    await expect.poll(() => shown(hall.page, OUT), { timeout: 10_000 }).toBe('WALL');
    await expect.poll(() => shown(win, LIVE), { timeout: 10_000 }).toBe('WALL');
    // Said plainly: the file and the screen.
    await expect
      .poll(() => notices(win), { timeout: 10_000, message: 'a notice names the file and the screen' })
      .toContainEqual(
        expect.stringMatching(new RegExp(`Placeholder fails on the hall[\\s\\S]*${hall.name}`, 'u')),
      );
    // Logged: the error's kind and the screen.
    await expect
      .poll(() => logOf(userData), {
        timeout: 10_000,
        message: 'the log names the error’s kind and the screen',
      })
      .toMatch(new RegExp(`could not play on the screen “${hall.name}” \\([^)]+\\)`, 'u'));
  } finally {
    await app.close();
  }
});

test('a video cut with no movie box (a copy or a download stopped part-way), put up over a picture: the hall keeps the picture, it comes off with a notice naming it and the screen, and no sound plays', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-cut-'));
  const clip = makeClip(join(dir, 'Placeholder cut copy.mp4'), 'h264-moov-at-end', 12, 330);
  truncateSync(clip, Math.floor(statSync(clip).size * 0.6));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [id = ''] = await importAndGetIds(win, [clip]);
    expect(id, 'a cut file still comes in (FFmpeg reads nothing in it; its header is not sure)').not.toBe('');
    const { item } = await openNewPlaylist(win, 'Placeholder cut copy', id);
    await pictureUp(win, hall.page, beforeId);
    await row(win, item).click();
    const w = await watch(app, win, hall.page, id, 8_000, false);
    expect(w.off, `it came off: ${w.looks.join(' | ')}`).toBe(true);
    expect(w.black, `the hall never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
    expect(
      w.looks.filter((l) => l.includes('+sound')),
      `no sound for a file that cannot play: ${w.looks.join(' | ')}`,
    ).toEqual([]);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 10_000 }).toBe('WALL');
    await expect
      .poll(() => notices(win), { timeout: 10_000, message: 'a notice names the file and the screen' })
      .toContainEqual(expect.stringMatching(new RegExp(`Placeholder cut copy[\\s\\S]*${hall.name}`, 'u')));
  } finally {
    await app.close();
  }
});

test('a video that stops part-way (cut half-way, or damaged in its middle): at its failure it comes off with its sound, the hall never black, and a notice names it and the screen', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-part-'));
  const half = makeClip(join(dir, 'Placeholder cut half-way.mp4'), 'h264', 12, 392);
  truncateSync(half, Math.floor(statSync(half).size * 0.5));
  const damaged = damageMiddle(makeClip(join(dir, 'Placeholder damaged middle.mp4'), 'h264', 12, 494));
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    for (const [file, name] of [
      [half, 'Placeholder cut half-way'],
      [damaged, 'Placeholder damaged middle'],
    ] as const) {
      const [id = ''] = await importAndGetIds(win, [file]);
      const { item } = await openNewPlaylist(win, name, id);
      await pictureUp(win, hall.page, beforeId);
      await row(win, item).click();
      await expect
        .poll(() => shown(hall.page, OUT), { timeout: 30_000, message: `${name}: it plays` })
        .toBe('VIDEO');
      // Until it is off, or the engine's own end of its 12 s.
      const w = await watch(app, win, hall.page, id, 14_000, false);
      expect(w.blackWithSound, `${name}: never black while its sound played: ${w.looks.join(' | ')}`).toBe(0);
      expect(w.black, `${name}: never black while it was up: ${w.looks.join(' | ')}`).toBe(0);
      // Off at its failure (about 4-6 s in), not at the engine's own end of its 12 s.
      const offAt = Number(/^(\d+)ms/u.exec(w.looks.find((l) => l.includes('(bg ')) ?? '')?.[1] ?? NaN);
      expect(
        offAt,
        `${name}: it came off at its failure, well before its 12 s: ${w.looks.join(' | ')}`,
      ).toBeLessThan(10_000);
      await expect
        .poll(() => soundPlays(app), { timeout: 5_000, message: `${name}: its sound stopped` })
        .toBe(false);
      await expect
        .poll(() => notices(win), { timeout: 10_000, message: `${name}: a notice names it and the screen` })
        .toContainEqual(expect.stringMatching(new RegExp(`${name}[\\s\\S]*${hall.name}`, 'u')));
      await dispatch(win, { type: 'clearAll' });
    }
  } finally {
    await app.close();
  }
});
