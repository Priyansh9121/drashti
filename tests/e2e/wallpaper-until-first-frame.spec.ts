import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import {
  audienceScreen,
  before,
  dispatch,
  domLook,
  failVideo,
  installLooks,
  isBlack,
  LIVE,
  makeClip,
  openNewPlaylist,
  OUT,
  recAll,
  row,
  SCREENS,
  showPicture,
  shown,
  slowWallpaper,
  stopAll,
  streamWatched,
  wallpaperAndPicture,
} from './hall-looks';
import { testFfmpeg } from './stream-helpers';

/*
 * The Wallpaper kept until a video's first frame (Q60-31, the owner's own bug: his video's sound played while LIVE
 * showed black or the Wallpaper). x46's hunt (CI x46-1120-112649-63694) showed, on every video put up and on both
 * systems: from the Wallpaper (nothing up) the hall, LIVE and the stream went BLACK until the video's first frame
 * (31-446 ms there; seconds on a slow computer or a slow first frame), because the Wallpaper goes the moment the engine
 * has a background (render/Scene.tsx's nothing-up); and from the Wallpaper (F12) or Black-out over a picture, the
 * picture they hid came back until the first frame, because putting a video up takes the cover off at once. What the
 * hall saw stays until the video's first frame: the Wallpaper, or the cover over the picture; never black, never the
 * hidden picture. Frame by frame on the hall, LIVE and the stream, by each page's own markup.
 */

const ffmpeg = testFfmpeg();

test.beforeAll(() => {
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
});

test('from the Wallpaper (nothing up), from the Wallpaper over a picture (F12) and from Black-out over a picture, a video put up: until its first frame the hall, LIVE and the stream show what they showed, never black, never the hidden picture', async () => {
  test.setTimeout(480_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-until-first-frame-'));
  const clips = {
    'a small video': makeClip(join(dir, 'Placeholder small video.mp4'), 'h264', 8),
    'the owner’s file’s shape (1080p, 18 Mb/s, movie box at the end)': makeClip(
      join(dir, 'Placeholder export shape.mp4'),
      'owner',
      30,
      392,
    ),
  };
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = (await audienceScreen(app, win)).page;
    const beforeId = await wallpaperAndPicture(win, dir);
    const stream = await streamWatched(app, win);
    await installLooks(hall, OUT);
    await installLooks(win, LIVE);
    const pages = [hall, win, stream];
    const bad: string[] = [];
    for (const [clipName, clip] of Object.entries(clips)) {
      const [clipId = ''] = await importAndGetIds(win, [clip]);
      expect(clipId, clipName).not.toBe('');
      const { item } = await openNewPlaylist(win, `Placeholder until ${clipName.slice(2, 7)}`, clipId);
      for (const start of [
        'nothing up',
        'the Wallpaper over a picture',
        'Black-out over a picture',
      ] as const) {
        for (const round of [1, 2]) {
          await dispatch(win, { type: 'clearAll' });
          let first = 'WALL';
          if (start !== 'nothing up') {
            await showPicture(win, beforeId);
            await expect.poll(() => shown(hall, OUT), { timeout: 20_000 }).toBe('BEFORE');
            if (start === 'Black-out over a picture') {
              await dispatch(win, { type: 'toggleBlackout' });
              first = 'BLACKOUT';
            } else await dispatch(win, { type: 'toggleWallpaper' });
          }
          for (const [page, what] of [
            [hall, 'the hall'],
            [win, 'LIVE'],
            [stream, 'the stream'],
          ] as const)
            await expect
              .poll(() => domLook(page), { timeout: 20_000, message: `${what}: ${first}` })
              .toBe(first);
          await recAll(pages);
          await row(win, item).click();
          for (const [page, what] of [
            [hall, 'the hall'],
            [win, 'LIVE'],
            [stream, 'the stream'],
          ] as const)
            await expect
              .poll(() => domLook(page), { timeout: 30_000, message: `${what}: the video` })
              .toBe('VIDEO');
          const [h = [], l = [], s = []] = await stopAll(pages);
          const when = `${clipName}, ${start}, round ${String(round)}`;
          for (const [looks, what] of [
            [h, 'the hall'],
            [l, 'LIVE'],
            [s, 'the stream'],
          ] as const) {
            const black = before(looks, isBlack);
            const hidden = before(looks, (x) => x === 'PIC');
            if (black.frames > 0)
              bad.push(
                `${when}: ${what} black ${String(black.frames)} frames (${String(black.ms)} ms): ${looks.join(' → ')}`,
              );
            if (hidden.frames > 0)
              bad.push(
                `${when}: ${what} showed the hidden picture ${String(hidden.frames)} frames (${String(hidden.ms)} ms): ${looks.join(' → ')}`,
              );
          }
        }
      }
    }
    expect(
      bad,
      'until a video’s first frame: what was there before, never black, never the hidden picture',
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test('back to the Wallpaper (Clear background over a picture and over a video, a video’s end, a video that cannot play coming off): what was up stays until the Wallpaper’s picture has come, never black between, on the hall, LIVE and the stream', async () => {
  test.setTimeout(480_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-back-to-the-wall-'));
  const clip = makeClip(join(dir, 'Placeholder back to the wall.mp4'), 'h264', 30, 410);
  const short = makeClip(join(dir, 'Placeholder ends by itself.mp4'), 'h264', 6, 450);
  const { app } = await launchApp(SCREENS);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = (await audienceScreen(app, win)).page;
    const beforeId = await wallpaperAndPicture(win, dir);
    const stream = await streamWatched(app, win);
    await installLooks(hall, OUT);
    await installLooks(win, LIVE);
    const pages = [hall, win, stream];
    // The Wallpaper's picture comes 600 ms late each time it is drawn anew, as from a slow disk (within the 1 s that what
    // was up may stay): the page keeps a picture it showed, so this is the page's own seam (hall-looks.ts).
    const wallId = await win.evaluate(
      async () =>
        (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.chosenWallpaper?.pictures[0] ??
        '',
    );
    expect(wallId, 'the Wallpaper’s picture').not.toBe('');
    const slow = (on: boolean) => Promise.all(pages.map((p) => slowWallpaper(p, wallId, 600, on)));
    const [clipId = '', shortId = ''] = await importAndGetIds(win, [clip, short]);
    expect(clipId !== '' && shortId !== '').toBe(true);
    const { item: shortItem } = await openNewPlaylist(win, 'Placeholder ends by itself', shortId);
    const allShow = async (look: string, what: string) => {
      for (const [page, name] of [
        [hall, 'the hall'],
        [win, 'LIVE'],
        [stream, 'the stream'],
      ] as const)
        await expect
          .poll(() => domLook(page), { timeout: 30_000, message: `${what}: ${name} shows ${look}` })
          .toBe(look);
    };
    const putUpVideo = () =>
      dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: true },
      });
    const bad: string[] = [];
    const round = async (
      what: string,
      up: () => Promise<unknown>,
      upLook: string,
      back: () => Promise<unknown>,
    ) => {
      await dispatch(win, { type: 'clearAll' });
      await allShow('WALL', `${what}, before`);
      await up();
      await allShow(upLook, `${what}, up`);
      await slow(true);
      await recAll(pages);
      await back();
      await allShow('WALL', `${what}, back to the Wallpaper`);
      const [h = [], l = [], st = []] = await stopAll(pages);
      await slow(false);
      for (const [looks, name] of [
        [h, 'the hall'],
        [l, 'LIVE'],
        [st, 'the stream'],
      ] as const)
        if (looks.some(isBlack)) bad.push(`${what}: ${name}: ${looks.join(' → ')}`);
    };
    await round(
      'Clear background over a picture',
      () => showPicture(win, beforeId),
      'PIC',
      () => dispatch(win, { type: 'clearLayer', layer: 'background' }),
    );
    await round('Clear background over a video', putUpVideo, 'VIDEO', () =>
      dispatch(win, { type: 'clearLayer', layer: 'background' }),
    );
    // Its row's default at its end, with a wallpaper chosen: the video goes, and nothing is up.
    await round(
      'a video’s end',
      () => row(win, shortItem).click(),
      'VIDEO',
      () => Promise.resolve(),
    );
    await round('a video that cannot play coming off', putUpVideo, 'VIDEO', async () => {
      expect(await failVideo(hall, clipId), 'the hall’s video element').toBe(true);
    });
    expect(bad, 'back to the Wallpaper: never black between').toEqual([]);
  } finally {
    await app.close();
  }
});
