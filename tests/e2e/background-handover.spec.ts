import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAndGetIds, launchApp, operatorPage, operatorReady } from './helpers';
import { audienceScreen, dispatch, makeClip, OUT, SCREENS, shown, wallpaperAndPicture } from './hall-looks';
import { testFfmpeg } from './stream-helpers';

/*
 * A video put up over a picture never shows the hall a black frame between them (alpha.20's "never black"; the
 * coordinator's ask after video-no-picture.spec.ts:371 flaked on CI's Mac). The video was shown the moment its data
 * was in, in the same drawing that took the picture away, before Chromium had ever presented a frame of it: Main's own
 * readback of the hall window (capturePage) saw one black frame there (x54-1121-023510-80364, one try in 21). The rule
 * tested: when the picture before goes, the video has already been presented on the screen at least once while
 * shown (requestVideoFrameCallback, read on the hall page as it happens); and Main's own readback of the hall's middle
 * never reads black between the picture and the video. Generated media and placeholder names only.
 */

test.skip(
  !testFfmpeg() && !process.env['CI'],
  'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs',
);

interface Handover {
  /** The picture before seen on the page. */
  had: boolean;
  /** When it went (ms since the epoch), or null. */
  goneAt: number | null;
  /** The video's frames presented while it was shown (opacity 1), by then. */
  presentedShown: number;
  /** The same, counted from its first presented frame, whatever its opacity. */
  presented: number;
  /** presentedShown as the picture went. */
  atGone: number | null;
}

test('a video put up over a picture: the picture stays until the video has been presented on the screen, never a black frame between (Main’s own readback, CI x54-1121-023510-80364)', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-handover-'));
  const clip = makeClip(join(dir, 'Placeholder hand-over clip.mp4'), 'h264', 20);
  const { app } = await launchApp({ ...SCREENS });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app, win);
    const beforeId = await wallpaperAndPicture(win, dir);
    const [clipId = ''] = await importAndGetIds(win, [clip]);
    expect(clipId).not.toBe('');
    const centre = await hall.page.evaluate((root) => {
      const scene = document.querySelector(`${root} [data-testid="scene"]`)?.getBoundingClientRect();
      return scene
        ? { x: Math.round(scene.left + scene.width / 2), y: Math.round(scene.top + scene.height * 0.45) }
        : null;
    }, OUT);
    expect(centre, 'the hall’s scene').not.toBeNull();
    for (let round = 1; round <= 3; round++) {
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: beforeId, media: 'image', fit: 'fill', loop: false },
      });
      await expect.poll(() => shown(hall.page, OUT), { timeout: 20_000 }).toBe('BEFORE');
      // The hall page notes, as it happens, when the picture goes and how often the video was presented by then.
      await hall.page.evaluate(
        ({ root, before, video }) => {
          const g = globalThis as { handover?: Handover; handoverStop?: () => void };
          g.handoverStop?.();
          const h: Handover = { had: false, goneAt: null, presentedShown: 0, presented: 0, atGone: null };
          g.handover = h;
          const hooked = new WeakSet<HTMLVideoElement>();
          const look = () => {
            const v = document.querySelector<HTMLVideoElement>(`${root} video[data-media-id="${video}"]`);
            if (v && !hooked.has(v)) {
              hooked.add(v);
              const presented = () => {
                h.presented++;
                if (getComputedStyle(v).opacity === '1') h.presentedShown++;
                if (v.isConnected) v.requestVideoFrameCallback(presented);
              };
              v.requestVideoFrameCallback(presented);
            }
            const picture = document.querySelector(`${root} img[data-bg-slot^="${before}@"]`) !== null;
            if (picture) h.had = true;
            else if (h.had && h.goneAt === null) {
              h.goneAt = Date.now();
              // Frozen as the picture goes: what was presented while shown by then.
              h.atGone = h.presentedShown;
            }
          };
          const scene = document.querySelector(root);
          if (!scene) throw new Error('no output root');
          const watcher = new MutationObserver(look);
          watcher.observe(scene, { subtree: true, childList: true, attributes: true });
          look();
          g.handoverStop = () => {
            watcher.disconnect();
          };
        },
        { root: OUT, before: beforeId, video: clipId },
      );
      // Main's own readback of the hall window's middle, as fast as it comes, while the video goes up.
      const hallUrl = hall.page.url();
      const native = app.evaluate(
        async ({ BrowserWindow }, { url, at, ms }) => {
          const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === url);
          if (!w || !at) return [] as number[][];
          const out: number[][] = [];
          const end = Date.now() + ms;
          while (Date.now() < end) {
            const image = await w.webContents.capturePage({ x: at.x, y: at.y, width: 2, height: 2 });
            const b = image.toBitmap();
            out.push([b[2] ?? -1, b[1] ?? -1, b[0] ?? -1]);
          }
          return out;
        },
        { url: hallUrl, at: centre, ms: 4000 },
      );
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId: clipId, media: 'video', fit: 'fill', loop: true },
      });
      await expect.poll(() => shown(hall.page, OUT), { timeout: 20_000 }).toBe('VIDEO');
      // Main's readback done before anything is judged (a failure closes the app under it otherwise, and says that
      // instead: x54-1121-033831-8468).
      const samples = await native;
      const seen = await hall.page.evaluate(() => {
        const g = globalThis as { handover?: Handover; handoverStop?: () => void };
        g.handoverStop?.();
        return g.handover ?? null;
      });
      expect(
        seen?.goneAt,
        `round ${String(round)}: the picture before went: ${JSON.stringify(seen)}`,
      ).not.toBeNull();
      expect(
        seen?.atGone ?? 0,
        `round ${String(round)}: the video was presented on the screen, shown, before the picture went: ${JSON.stringify(seen)}`,
      ).toBeGreaterThan(0);
      // Main's readback: the picture before, then the video, never black between.
      const looks = samples.map(([r = 0, g = 0, b = 0]) =>
        Math.max(r, g, b) <= 12 ? 'BLACK' : r > 150 && g < 120 && b < 80 ? 'VIDEO' : 'OTHER',
      );
      const first = looks.indexOf('VIDEO');
      expect(
        looks.slice(0, first < 0 ? looks.length : first).filter((l) => l === 'BLACK'),
        `round ${String(round)}: Main’s readback before the video: ${looks.slice(0, Math.max(0, first) + 2).join(', ')}`,
      ).toEqual([]);
    }
  } finally {
    await app.close();
  }
});
