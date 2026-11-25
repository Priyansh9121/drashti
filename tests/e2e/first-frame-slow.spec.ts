import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, letTimePass, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  backgroundUp,
  dispatch,
  installLooks,
  notices,
  OUT,
  SCREENS,
  shown,
  wallpaperAndPicture,
} from './hall-looks';
import { logLines } from './log-lines';
import { testFfmpeg } from './stream-helpers';

/*
 * Slow is not "cannot play" (Q60-51, the owner's "Yes, A" of 20 Nov 2026, from x52's A11: under a heavy load a file
 * that plays fine was taken off at 10 s as "damaged", the hall black under the picture-in-picture box meanwhile). A
 * video comes off only after 10 s with no progress at all; one still loading gets up to 30 s and is then said not to
 * have started in time, never damaged; the Wallpaper stays meanwhile, under the box too, never black. A first frame is
 * made slow by sending every file at a test pace (DRASHTI_TEST_MEDIA_PACE_BPS), stalled by holding every file back
 * (DRASHTI_TEST_MEDIA_DELAY_MS). One lossless frame of noise (a few MB) only; placeholder names.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

/**
 * Ten seconds at 1920 × 1080 whose first frame is noise of a few MB around the test video's orange in its middle (where
 * a look reads the screen: hall-looks.ts `shown`), and every frame after it the same (a few bytes each): H.264 High
 * 8-bit 4:2:0, which every player here decodes, so its first frame comes late at a slow pace and nothing else stops it.
 * (A lossless frame is High 4:4:4 Predictive, which this computer's player cannot draw: it came off at once as a file
 * that cannot play, so the first CI runs never reached the start watch: x47-1120-194410-66097. Noise alone in its
 * middle never read as the video's picture.)
 */
function bigFirstFrame(file: string): string {
  const r = spawnSync(
    ffmpeg ?? '',
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
      ...[
        '-f',
        'lavfi',
        '-i',
        'nullsrc=s=1920x1080:r=25,geq=lum=random(1)*255:cb=128:cr=128,drawbox=x=760:y=336:w=400:h=300:color=0xd9480f:t=fill,trim=end_frame=1,loop=loop=249:size=1:start=0,setpts=N/25/TB',
      ],
      ...[
        '-frames:v',
        '250',
        '-c:v',
        'libx264',
        '-qp',
        '1',
        '-profile:v',
        'high',
        '-g',
        '250',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        file,
      ],
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return file;
}

/** The video made, and the pace (bytes a second) at which its file takes `seconds` to come. */
function slowVideo(seconds: number): { file: string; pace: string } {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-first-frame-'));
  const file = bigFirstFrame(join(dir, 'Placeholder slow start.mp4'));
  return { file, pace: String(Math.max(4096, Math.floor(statSync(file).size / seconds))) };
}

async function start(env: Record<string, string>) {
  const { app, userData } = await launchApp({ ...SCREENS, ...env });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await audienceScreen(app, win);
  await installLooks(hall.page, OUT);
  // Main's lines about videos (which page's word took one off, with what its watch saw), said by a failure.
  const mainSaid = (): string =>
    existsSync(join(userData, 'logs'))
      ? logLines(userData)
          .filter((l) => l.includes('A video'))
          .slice(-6)
          .join(' | ')
      : '(no log)';
  return { app, win, hall, mainSaid };
}

/**
 * Put the video up as the background: taken, and up, before any time is counted. It goes round, so its own end never
 * takes it off: by the show's time a 10 s video ends at 10 s, loaded or not, and with a wallpaper chosen it goes then
 * (When it ends, the Wallpaper: the default), which was all that took it off in every earlier run (x54-1121-023104-76071:
 * Main logged no video that could not play, on either system).
 */
async function upAsBackground(win: Page, mediaId: string): Promise<void> {
  const result = await dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: true },
  });
  expect(result.ok, 'the background is taken').toBe(true);
  expect(await backgroundUp(win), 'the video is up').toBe(mediaId);
}

/** Every look at the hall until `until` says so, each a few hundred ms apart: what it showed. */
async function looksUntil(
  win: Page,
  hall: Page,
  done: () => Promise<boolean>,
  ms: number,
): Promise<string[]> {
  const seen: string[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end && !(await done())) {
    seen.push(await shown(hall, OUT));
    await letTimePass(win, 300, 'the hall looked at again');
  }
  return seen;
}

test('a video that still loads is not taken off at 10 s: the Wallpaper meanwhile, never black, then it plays, and nobody is told it failed', async () => {
  test.setTimeout(180_000);
  const video = slowVideo(18);
  const { app, win, hall, mainSaid } = await start({ DRASHTI_TEST_MEDIA_PACE_BPS: video.pace });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-first-frame-wall-'));
    await wallpaperAndPicture(win, dir);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('WALL');
    const [id = ''] = await importAndGetIds(win, [video.file]);
    expect(id).not.toBe('');
    await upAsBackground(win, id);
    const went = Date.now();
    const seen = await looksUntil(
      win,
      hall.page,
      async () => (await shown(hall.page, OUT)) === 'VIDEO',
      60_000,
    );
    expect(seen, 'never black while it started').not.toContain('BLACK');
    expect(await shown(hall.page, OUT), `it plays once its first frame comes; Main: ${mainSaid()}`).toBe(
      'VIDEO',
    );
    expect(
      Date.now() - went,
      'its first frame came after 10 s (the old bound would have taken it off)',
    ).toBeGreaterThan(10_000);
    expect(await backgroundUp(win)).toBe(id);
    expect((await notices(win)).filter((n) => n.includes('could not'))).toEqual([]);
  } finally {
    await app.close();
  }
});

test('while the hall waits for a video’s first frame (the owner’s QA23-HALLDROP-1 (a), “Words during the wait”), LIVE says “Starting on the screen …” from about 2 s after it went up, and the line goes once the hall draws it', async () => {
  test.setTimeout(180_000);
  const video = slowVideo(12);
  const { app, win, hall, mainSaid } = await start({ DRASHTI_TEST_MEDIA_PACE_BPS: video.pace });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-first-frame-words-'));
    await wallpaperAndPicture(win, dir);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('WALL');
    const [id = ''] = await importAndGetIds(win, [video.file]);
    expect(id).not.toBe('');
    await upAsBackground(win, id);
    const line = win.getByTestId('live-starting');
    await expect(line, `LIVE says it is starting there; Main: ${mainSaid()}`).toContainText(
      `Starting on the screen “${hall.name}”…`,
      { timeout: 10_000 },
    );
    await expect.poll(() => shown(hall.page, OUT), { timeout: 60_000, message: 'it plays' }).toBe('VIDEO');
    await expect(line, 'the line goes once the hall draws it')
      .toHaveCount(0, { timeout: 10_000 })
      .catch(async (e: unknown) => {
        // What Main and the hall's videos said by then, for the failure's words.
        const videos = await hall.page.evaluate(() =>
          [...document.querySelectorAll('video')]
            .map(
              (v) =>
                `${v.dataset['mediaId'] ?? '?'} ready ${String(v.readyState)} ${v.dataset['state'] ?? ''}`,
            )
            .join(' | '),
        );
        throw new Error(`${String(e)}\nMain: ${mainSaid()}\nThe hall's videos: ${videos}`);
      });
    expect((await notices(win)).filter((n) => n.includes('could not'))).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a video still loading with no first frame by 30 s comes off then, said not to have started in time, never damaged; the Wallpaper meanwhile', async () => {
  test.setTimeout(180_000);
  const video = slowVideo(60);
  const { app, win, hall, mainSaid } = await start({ DRASHTI_TEST_MEDIA_PACE_BPS: video.pace });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-first-frame-wall-'));
    await wallpaperAndPicture(win, dir);
    await expect.poll(() => shown(hall.page, OUT), { timeout: 30_000 }).toBe('WALL');
    const [id = ''] = await importAndGetIds(win, [video.file]);
    await upAsBackground(win, id);
    const went = Date.now();
    const seen = await looksUntil(win, hall.page, async () => (await backgroundUp(win)) !== id, 60_000);
    const after = Date.now() - went;
    expect(seen, 'never black while it tried to start').not.toContain('BLACK');
    expect(await backgroundUp(win), 'taken off').not.toBe(id);
    expect(after, `not before 30 s, while it still loaded; Main: ${mainSaid()}`).toBeGreaterThan(29_000);
    expect(after, 'soon after 30 s').toBeLessThan(40_000);
    await expect
      .poll(() => notices(win), { timeout: 10_000 })
      .toContainEqual(expect.stringContaining('could not start in time'));
    expect((await notices(win)).some((n) => n.includes('damaged'))).toBe(false);
  } finally {
    await app.close();
  }
});

test('a video with no progress at all still comes off at 10 s, as before', async () => {
  test.setTimeout(180_000);
  const video = slowVideo(1);
  const { app, win } = await start({ DRASHTI_TEST_MEDIA_DELAY_MS: '60000' });
  try {
    const [id = ''] = await importAndGetIds(win, [video.file]);
    await upAsBackground(win, id);
    const went = Date.now();
    await expect.poll(() => backgroundUp(win), { timeout: 30_000 }).not.toBe(id);
    const after = Date.now() - went;
    expect(after, 'not before 10 s').toBeGreaterThan(9000);
    expect(after, 'soon after 10 s').toBeLessThan(20_000);
  } finally {
    await app.close();
  }
});

test('with the picture-in-picture box up, the hall under it shows the Wallpaper until the background’s first frame, never black; swapped, the box’s own picture', async () => {
  test.setTimeout(180_000);
  const video = slowVideo(18);
  const { app, win, hall } = await start({ DRASHTI_TEST_MEDIA_PACE_BPS: video.pace });
  try {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-first-frame-wall-'));
    const pictureId = await wallpaperAndPicture(win, dir);
    const scene = hall.page.getByTestId('scene');
    await expect(scene).toHaveAttribute('data-nothing-up', 'wallpaper', { timeout: 30_000 });
    expect((await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: pictureId } })).ok).toBe(
      true,
    );
    const [id = ''] = await importAndGetIds(win, [video.file]);
    await upAsBackground(win, id);
    // The background's first frame pending: the Wallpaper under the box, as with no box.
    await letTimePass(win, 3000, 'the background is loading');
    await expect(scene).toHaveAttribute('data-pip', 'up');
    await expect(scene).toHaveAttribute('data-nothing-up', 'wallpaper');
    // Swapped: the box's own picture is in the background's place, so nothing-up is not drawn over it.
    expect((await dispatch(win, { type: 'swapPip' })).ok).toBe(true);
    await expect(scene).toHaveAttribute('data-pip', 'swapped');
    await expect(scene).not.toHaveAttribute('data-nothing-up', /./u);
  } finally {
    await app.close();
  }
});
