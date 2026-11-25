import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
} from './helpers';
import { logText } from './log-lines';
import { decodePng } from './png-decode';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';
import { mediaUrl } from '../../src/shared/media';

/*
 * A video whose picture this computer cannot draw (Session 60, x36; the owner, 19 Nov 2026, on alpha.19: "when playing
 * a video, the wallpaper shows up, when toggled the wallpaper off, the screen in audience shows black, but the video is
 * playing"). Chromium plays such a file as sound only, with no error: the screens' video says it has data, at 0 × 0
 * with no frame, its sound plays and its clock runs, and the hall sees black (reproduced on alpha.19 and phase1, CI's
 * Windows, with HEVC taken as playable where it cannot be decoded). His answer, "Yes, A": noticed within a second or
 * two; the screens keep what they showed until then; then the video comes off with its sound (in the picture-in-picture
 * box, the box comes off: Q60-46, never a black box); a plain notice says so; Drashti converts the file by itself once the show is
 * idle, and the copy is used from then on. The stand-ins: FFV1 in a .mov, which no Chromium decodes, judged by its
 * header alone as a library imported before Session 50 judged it (DRASHTI_TEST_NO_CONVERT_AT_IMPORT: "not sure, tried
 * when used"), on both systems; and HEVC taken as playable (DRASHTI_TEST_PLAYS_HEVC), which CI's Windows cannot decode
 * and CI's Mac can. Generated media and placeholder names only.
 */

const ffmpeg = testFfmpeg();

/** The test video's colour (orange), the picture up before it (green), the chosen wallpaper (blue). */
const VIDEO_RGB: [number, number, number] = [217, 72, 15];
const BEFORE_RGB: [number, number, number] = [20, 83, 45];
const WALL_RGB: [number, number, number] = [30, 58, 138];

type Seen = 'VIDEO' | 'BEFORE' | 'WALL' | 'BLACK' | 'OTHER';

function seenOf(rgba: number[]): Seen {
  const near = (rgb: [number, number, number], within: number) =>
    rgb.every((c, i) => Math.abs((rgba[i] ?? -999) - c) <= within);
  if (near(VIDEO_RGB, 45)) return 'VIDEO';
  if (near(BEFORE_RGB, 40)) return 'BEFORE';
  if (near(WALL_RGB, 40)) return 'WALL';
  if (near([0, 0, 0], 12)) return 'BLACK';
  return 'OTHER';
}

/**
 * A generated video of `seconds` with a tone: FFV1 in a .mov, HEVC (8-bit 4:2:0 unless another kind is asked), or
 * H.264 (which every computer draws).
 */
function makeVideo(
  path: string,
  codec: 'ffv1' | 'hevc' | 'h264',
  seconds: number,
  pixFmt = 'yuv420p',
): string {
  const picture = ['-f', 'lavfi', '-i', `color=c=0xd9480f:s=320x180:r=30:d=${String(seconds)}`];
  const tone = ['-f', 'lavfi', '-i', `sine=f=440:r=48000:d=${String(seconds)}`];
  const video =
    codec === 'ffv1'
      ? ['-c:v', 'ffv1']
      : codec === 'h264'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
        : [
            '-c:v',
            'libx265',
            '-preset',
            'ultrafast',
            '-pix_fmt',
            pixFmt,
            '-tag:v',
            'hvc1',
            '-x265-params',
            'log-level=error',
          ];
  const r = spawnSync(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      ...picture,
      ...tone,
      ...video,
      '-c:a',
      'aac',
      path,
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return path;
}

const snapshot = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;
const dispatch = (win: Page, command: Record<string, unknown>) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** Whether the video's sound plays in the audio player now. */
const soundPlays = async (app: ElectronApplication, mediaId: string): Promise<boolean> => {
  const audio = app.windows().find((w) => w.url().includes('audio.html'));
  if (!audio) return false;
  return audio.evaluate(
    (id) =>
      [...document.querySelectorAll<HTMLMediaElement>('audio')].some(
        (e) => e.dataset['mediaId'] === id && !e.paused && e.currentTime > 0.05,
      ),
    mediaId,
  );
};

/** What a page's scene shows at its middle (an output's, or LIVE's in the operator window). */
async function shown(page: Page, root: string): Promise<Seen> {
  const box = await page.evaluate((r) => {
    const scene = document.querySelector(`${r} [data-testid="scene"]`)?.getBoundingClientRect();
    return scene ? { x: scene.left + scene.width / 2, y: scene.top + scene.height * 0.45 } : null;
  }, root);
  if (!box) return 'OTHER';
  const { width, height, rgba } = decodePng(await page.screenshot({ scale: 'css' }));
  const x = Math.min(width - 1, Math.max(0, Math.round(box.x)));
  const y = Math.min(height - 1, Math.max(0, Math.round(box.y)));
  const at = (y * width + x) * 4;
  return seenOf([rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0]);
}

/**
 * From a video's putting up until it is off the screens (or `ms`): what the page showed while its sound played, each
 * look. The owner's rule: never black (nor anything but the video or what was there before) while its sound plays.
 */
async function watchWhileItPlays(
  win: Page,
  app: ElectronApplication,
  page: Page,
  root: string,
  mediaId: string,
  ms: number,
): Promise<{ looks: string[]; off: boolean }> {
  const looks: string[] = [];
  const until = Date.now() + ms;
  for (;;) {
    // The screen first, then the sound, then the show (x46, Q60-31): a look still up was up when the screen was read, so
    // one taken as the video comes off is marked off, never a mix of two moments.
    const look = await shown(page, root);
    const plays = await soundPlays(app, mediaId);
    const bg = (await snapshot(win)).layers.background;
    const up = bg?.kind === 'media' && bg.mediaId === mediaId;
    looks.push(`${look}${plays ? '+sound' : ''}${up ? '' : ' (off)'}`);
    if (!up) return { looks, off: true };
    if (Date.now() > until) return { looks, off: false };
  }
}

/** The audience screen, ready to draw (Drashti's pretend display, set by itself as the audience's). */
async function audienceScreen(app: ElectronApplication): Promise<Page> {
  await app.evaluate((_electron) => {
    (globalThis as { drashtiTestDisplays?: (n: number) => void }).drashtiTestDisplays?.(1);
  });
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        found = undefined;
        for (const page of outputPages(app)) {
          if (page.isClosed()) continue;
          const role = await page
            .evaluate(() => document.querySelector('[data-testid="output-root"]')?.getAttribute('data-role'))
            .catch(() => null);
          if (role === 'audience') found = page;
        }
        return found !== undefined;
      },
      { timeout: 30_000, message: 'the audience screen opens' },
    )
    .toBe(true);
  if (!found) throw new Error('no audience screen');
  await outputReady(found);
  return found;
}

/** A blue wallpaper chosen (what the screens show with nothing up) and a green picture to put up before the video. */
async function wallpaperAndPicture(win: Page, dir: string): Promise<string> {
  const wall = await makeTestImage(win, join(dir, 'Placeholder wall.png'), {
    color: '#1e3a8a',
    width: 320,
    height: 180,
  });
  const before = await makeTestImage(win, join(dir, 'Placeholder before.png'), {
    color: '#14532d',
    width: 320,
    height: 180,
  });
  const [wallId = '', beforeId = ''] = await importAndGetIds(win, [wall, before]);
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.wallpapers.add([id], null);
    if (!added.ok) throw new Error(added.message);
    const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
    if (!chosen.ok) throw new Error(chosen.message);
  }, wallId);
  return beforeId;
}

/** A playlist of this media, open in the middle: its row's item id. */
async function openPlaylistOf(win: Page, name: string, mediaId: string): Promise<string> {
  const itemId = await win.evaluate(
    async ({ name, mediaId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create(name, null, false);
      if (!list.ok) throw new Error(list.message);
      const added = await d.playlists.addItems(list.ids[0] ?? '', null, [{ kind: 'media', mediaId }]);
      if (!added.ok) throw new Error(added.message);
      return added.ids[0] ?? '';
    },
    { name, mediaId },
  );
  await win.getByTestId('playlist-node').filter({ hasText: name }).click();
  await expect(win.getByTestId('open-playlist').getByTestId('playlist-item')).toHaveCount(1);
  return itemId;
}

const row = (win: Page, itemId: string) =>
  win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`).getByTestId('playlist-item');

const NOTICE = /can’t show its picture/u;

test('a video this computer cannot draw (FFV1, judged by its header) never plays as sound with a black picture: the screens keep what they showed, then it comes off with its sound, a plain notice says why, Drashti converts it by itself, and the copy plays', async () => {
  test.setTimeout(240_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-no-picture-'));
  const clip = makeVideo(join(dir, 'Placeholder no picture.mov'), 'ffv1', 12);
  const { app } = await launchApp({
    DRASHTI_TEST_AUTO_SCREENS: 'pretend',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
    DRASHTI_TEST_NO_CONVERT_AT_IMPORT: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [clipId = ''] = await importAndGetIds(win, [clip]);
    expect(clipId).not.toBe('');
    // Judged by its header alone, it is "not sure": it may go live, and is tried when used.
    const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    expect(media.find((m) => m.id === clipId)?.unplayable ?? null).toBeNull();
    const itemId = await openPlaylistOf(win, 'Placeholder no picture', clipId);

    // A picture up first: the hall sees it.
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: beforeId, media: 'image', fit: 'fill', loop: false },
    });
    await expect.poll(() => shown(hall, '[data-testid="output-root"]')).toBe('BEFORE');

    // The video's row: never black while its sound plays; within seconds it comes off with its sound.
    await row(win, itemId).click();
    const watched = await watchWhileItPlays(win, app, hall, '[data-testid="output-root"]', clipId, 10_000);
    expect(watched.off, `the video came off the screens: ${watched.looks.join(', ')}`).toBe(true);
    expect(
      watched.looks.filter(
        (look) => look.includes('+sound') && !look.endsWith('(off)') && !/^(VIDEO|BEFORE)/u.test(look),
      ),
      `never anything but the picture before while its sound played: ${watched.looks.join(', ')}`,
    ).toEqual([]);
    await expect.poll(() => soundPlays(app, clipId), { message: 'its sound stopped' }).toBe(false);
    // With nothing up the chosen wallpaper shows, on the hall's screen and LIVE.
    await expect.poll(() => shown(hall, '[data-testid="output-root"]')).toBe('WALL');
    await expect.poll(() => shown(win, '[data-testid="live-preview"]')).toBe('WALL');
    // Said plainly, by its name.
    await expect(win.getByTestId('operator-notice')).toContainText(NOTICE);
    await expect(win.getByTestId('operator-notice')).toContainText('Placeholder no picture');

    // Converted by itself (nothing is up), and the copy is used from then on: the same row plays its picture.
    await expect
      .poll(
        async () =>
          (await win.evaluate(() => (globalThis as PageGlobals).drashti.media.conversions())).find(
            (j) => j.mediaId === clipId,
          )?.state ?? 'none',
        { timeout: 120_000, message: 'converted by itself' },
      )
      .toBe('done');
    await row(win, itemId).click();
    await expect
      .poll(() => shown(hall, '[data-testid="output-root"]'), { timeout: 20_000, message: 'the copy plays' })
      .toBe('VIDEO');
    expect(await soundPlays(app, clipId)).toBe(false);
  } finally {
    await app.close();
  }
});

test('in the picture-in-picture box, a video this computer cannot draw comes off with the box, said plainly (Q60-46: never a black box)', async () => {
  test.setTimeout(150_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-no-picture-box-'));
  const clip = makeVideo(join(dir, 'Placeholder no picture box.mov'), 'ffv1', 12);
  const { app } = await launchApp({ DRASHTI_TEST_NO_CONVERT_AT_IMPORT: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const [clipId = ''] = await importAndGetIds(win, [clip]);
    expect(clipId).not.toBe('');
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: clipId } });
    await expect
      .poll(async () => (await snapshot(win)).layers.pip === null, {
        timeout: 10_000,
        message: 'the box came off',
      })
      .toBe(true);
    await expect(win.getByTestId('operator-notice')).toContainText(NOTICE);
  } finally {
    await app.close();
  }
});

test('HEVC taken as playable: where this computer decodes it (CI’s Mac) it plays; where it cannot (CI’s Windows) it is never sound with a black picture, and comes off, said plainly', async () => {
  test.setTimeout(150_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-no-picture-hevc-'));
  const clip = makeVideo(join(dir, 'Placeholder hevc.mp4'), 'hevc', 12);
  const { app } = await launchApp({ DRASHTI_TEST_PLAYS_HEVC: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [clipId = ''] = await importAndGetIds(win, [clip]);
    expect(clipId).not.toBe('');
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: beforeId, media: 'image', fit: 'fill', loop: false },
    });
    await expect.poll(() => shown(win, '[data-testid="live-preview"]')).toBe('BEFORE');
    // From Media (as the phone, the quick bar and the API put a file up), with no audience screen: LIVE alone.
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: false },
    });
    const watched = await watchWhileItPlays(win, app, win, '[data-testid="live-preview"]', clipId, 6000);
    expect(
      watched.looks.filter(
        (look) => look.includes('+sound') && !look.endsWith('(off)') && !/^(VIDEO|BEFORE)/u.test(look),
      ),
      `never anything but its picture, or the picture before, while its sound played: ${watched.looks.join(', ')}`,
    ).toEqual([]);
    if (watched.off) {
      // This computer cannot decode it: off with its sound, said plainly.
      await expect.poll(() => soundPlays(app, clipId)).toBe(false);
      await expect(win.getByTestId('operator-notice')).toContainText(NOTICE);
    } else {
      // It decodes it: its picture plays, as before.
      await expect.poll(() => shown(win, '[data-testid="live-preview"]')).toBe('VIDEO');
    }
  } finally {
    await app.close();
  }
});

test('a video only slow to load (served 3 s late, as from a slow disk) is never taken for one this computer cannot draw: the audience screen keeps the picture before until its first frame, then it plays; in the picture-in-picture box it plays on; no notice, nothing converted', async () => {
  test.setTimeout(150_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-slow-video-'));
  const clip = makeVideo(join(dir, 'Placeholder slow clip.mp4'), 'h264', 20);
  const { app } = await launchApp({
    DRASHTI_TEST_MEDIA_DELAY_MS: '3000',
    DRASHTI_TEST_AUTO_SCREENS: 'pretend',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // The audience screen: what the hall sees (the owner's rule, "the screens keep what they showed").
    const hall = await audienceScreen(app);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [clipId = ''] = await importAndGetIds(win, [clip]);
    expect(clipId).not.toBe('');
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: beforeId, media: 'image', fit: 'fill', loop: false },
    });
    await expect.poll(() => shown(hall, '[data-testid="output-root"]'), { timeout: 20_000 }).toBe('BEFORE');
    await dispatch(win, {
      type: 'setBackground',
      background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: false },
    });
    // While its file comes slowly: the picture before on the audience screen; then its own picture. Up all along,
    // never taken off.
    const looks: string[] = [];
    const until = Date.now() + 15_000;
    while (Date.now() < until && looks.at(-1) !== 'VIDEO') {
      const bg = (await snapshot(win)).layers.background;
      looks.push(await shown(hall, '[data-testid="output-root"]'));
      expect(bg?.kind === 'media' && bg.mediaId === clipId, `still up: ${looks.join(', ')}`).toBe(true);
    }
    expect(looks.at(-1), `its picture came: ${looks.join(', ')}`).toBe('VIDEO');
    expect(
      looks.filter((look) => look !== 'BEFORE' && look !== 'VIDEO'),
      `only the picture before, then its own: ${looks.join(', ')}`,
    ).toEqual([]);
    expect(looks[0], 'the picture before while its file came').toBe('BEFORE');
    // In the box (a slide's way of drawing a video): it plays on once its file has come, never paused.
    await dispatch(win, { type: 'showPip', source: { kind: 'media', mediaId: clipId } });
    await letTimePass(win, 8000, 'the box’s copy of the file comes 3 s late, and plays');
    expect((await snapshot(win)).layers.pip?.seeks?.[clipId]?.paused ?? false).toBe(false);
    const bg = (await snapshot(win)).layers.background;
    expect(bg?.kind === 'media' && bg.mediaId === clipId, 'the background still plays it').toBe(true);
    await expect(win.getByTestId('operator-notice').filter({ hasText: NOTICE })).toHaveCount(0);
    const jobs = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.conversions());
    expect(jobs.filter((j) => j.mediaId === clipId)).toEqual([]);
    const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
    expect(media.find((m) => m.id === clipId)?.unplayable ?? null).toBeNull();
  } finally {
    await app.close();
  }
});

/** Whether this computer's own video element draws a library file as it is: its picture, not its sound alone. */
const drawsHere = (win: Page, mediaId: string): Promise<boolean> =>
  win.evaluate(async (url) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    const loaded = await new Promise<boolean>((resolve) => {
      v.addEventListener('loadeddata', () => resolve(true), { once: true });
      v.addEventListener('error', () => resolve(false), { once: true });
      v.src = url;
    });
    const drawn = loaded && v.videoWidth > 0 && v.videoHeight > 0;
    v.removeAttribute('src');
    v.load();
    return drawn;
  }, mediaUrl(mediaId));

test('HEVC’s other kinds as this computer names them are true, and the import follows them: a kind it says it plays goes in as it is and its picture draws here; one it says it cannot is converted by itself at import, and its picture would not draw here (CI’s Mac draws them all, CI’s Windows none)', async () => {
  test.setTimeout(240_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-hevc-kinds-'));
  const files = {
    main10: makeVideo(join(dir, 'Placeholder ten bit.mp4'), 'hevc', 4, 'yuv420p10le'),
    rext: makeVideo(join(dir, 'Placeholder camera.mov'), 'hevc', 4, 'yuv422p10le'),
  };
  // This computer's own answers: none given.
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const logOf = () => logText(userData);
    const KINDS =
      /The other kinds of HEVC on this computer: Main 10 (plays|cannot play); 4:2:2, 4:4:4 and 12-bit (play|cannot play)/u;
    await expect
      .poll(logOf, { timeout: 60_000, message: 'the window said whether it plays HEVC' })
      .toMatch(/This computer (plays|cannot play) HEVC video/u);
    await expect.poll(logOf, { message: 'and its other kinds' }).toMatch(KINDS);
    const said = KINDS.exec(logOf());
    const playsHevc = logOf().includes('This computer plays HEVC video');
    const kinds = { main10: playsHevc && said?.[1] === 'plays', rext: playsHevc && said?.[2] === 'play' };
    for (const kind of ['main10', 'rext'] as const) {
      const [id = ''] = await importAndGetIds(win, [files[kind]]);
      expect(id).not.toBe('');
      const media = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listMedia());
      // As it is where this computer plays the kind, converted by itself where it cannot.
      expect(media.find((m) => m.id === id)?.unplayable ?? null, `${kind}: taken as it is`).toEqual(
        kinds[kind] ? null : expect.any(String),
      );
      // And what this computer said is so: its own video element draws the file as it is exactly where it said so.
      expect(await drawsHere(win, id), `${kind}: its picture draws here`).toBe(kinds[kind]);
    }
  } finally {
    await app.close();
  }
});
