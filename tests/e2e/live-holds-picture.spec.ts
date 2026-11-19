import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPages, outputReady } from './helpers';
import { decodePng } from './png-decode';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * LIVE keeps what it showed until the new background has its first frame, as the audience screen does (Session 60,
 * x36; Q60-23, the lead's finding while proving x36's guard). A background whose file comes late (a slow disk, a large
 * file) used to leave LIVE black meanwhile, the hall keeping its picture: LIVE's picture was drawn afresh, its
 * background starting empty, whenever a picture that can be zoomed live came or went. Every file here comes 3 s late
 * (DRASHTI_TEST_MEDIA_DELAY_MS). Generated media and placeholder names only.
 */

const ffmpeg = testFfmpeg();

/** The picture up first (green), the video (orange), the picture after it (purple). */
const BEFORE_RGB: [number, number, number] = [20, 83, 45];
const VIDEO_RGB: [number, number, number] = [217, 72, 15];
const AFTER_RGB: [number, number, number] = [107, 33, 168];

type Seen = 'BEFORE' | 'VIDEO' | 'AFTER' | 'BLACK' | 'OTHER';

function seenOf(rgba: number[]): Seen {
  const near = (rgb: [number, number, number], within: number) =>
    rgb.every((c, i) => Math.abs((rgba[i] ?? -999) - c) <= within);
  if (near(VIDEO_RGB, 45)) return 'VIDEO';
  if (near(BEFORE_RGB, 40)) return 'BEFORE';
  if (near(AFTER_RGB, 40)) return 'AFTER';
  if (near([0, 0, 0], 12)) return 'BLACK';
  return 'OTHER';
}

/** What a page's scene shows at its middle (LIVE's in the operator window, or an output's). */
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

/** The audience screen, ready to draw (Drashti's pretend display, set by itself as the audience's). */
async function audienceScreen(app: ElectronApplication): Promise<Page> {
  await app.evaluate(() => {
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

/** A generated H.264 video of `seconds` (orange) with a tone. */
function makeVideo(path: string, seconds: number): string {
  const r = spawnSync(
    ffmpeg ?? '',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0xd9480f:s=320x180:r=30:d=${String(seconds)}`,
      '-f',
      'lavfi',
      '-i',
      `sine=f=440:r=48000:d=${String(seconds)}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      path,
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return path;
}

const LIVE = '[data-testid="live-preview"]';
const HALL = '[data-testid="output-root"]';

/**
 * From a change of background until LIVE and the audience screen both show `to` (or 15 s): what each showed, look by
 * look.
 */
async function watchChange(win: Page, hall: Page, to: Seen): Promise<{ live: Seen[]; hall: Seen[] }> {
  const looks = { live: [] as Seen[], hall: [] as Seen[] };
  const until = Date.now() + 15_000;
  while (Date.now() < until && (looks.live.at(-1) !== to || looks.hall.at(-1) !== to)) {
    looks.live.push(await shown(win, LIVE));
    looks.hall.push(await shown(hall, HALL));
  }
  return looks;
}

/** LIVE showed only what it showed before and then the new background, as the hall did, never anything else. */
function heldLikeTheHall(looks: { live: Seen[]; hall: Seen[] }, from: Seen, to: Seen): void {
  const said = `LIVE ${looks.live.join(', ')} | the hall ${looks.hall.join(', ')}`;
  expect(looks.live.at(-1), `LIVE came to the new background: ${said}`).toBe(to);
  expect(looks.hall.at(-1), `the hall came to the new background: ${said}`).toBe(to);
  expect(
    looks.hall.filter((s) => s !== from && s !== to),
    `the hall kept its picture: ${said}`,
  ).toEqual([]);
  expect(
    looks.live.filter((s) => s !== from && s !== to),
    `LIVE kept what it showed until the new one drew, as the hall did: ${said}`,
  ).toEqual([]);
  expect(looks.live[0], `LIVE still showed the picture before as the change came: ${said}`).toBe(from);
  for (const s of looks.live)
    expect(looks.hall, `LIVE never showed what the hall did not: ${said}`).toContain(s);
}

test('LIVE keeps what it showed until a late background has its first frame, as the audience screen does: a picture to a video, and the video to a picture', async () => {
  test.setTimeout(180_000);
  expect(ffmpeg, 'the bundled FFmpeg').not.toBeNull();
  const dir = mkdtempSync(join(tmpdir(), 'drashti-live-holds-'));
  const clip = makeVideo(join(dir, 'Placeholder late clip.mp4'), 30);
  const { app } = await launchApp({
    DRASHTI_TEST_MEDIA_DELAY_MS: '3000',
    DRASHTI_TEST_AUTO_SCREENS: 'pretend',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const hall = await audienceScreen(app);
    const before = await makeTestImage(win, join(dir, 'Placeholder before.png'), {
      color: '#14532d',
      width: 320,
      height: 180,
    });
    const after = await makeTestImage(win, join(dir, 'Placeholder after.png'), {
      color: '#6b21a8',
      width: 320,
      height: 180,
    });
    const [beforeId = '', clipId = '', afterId = ''] = await importAndGetIds(win, [before, clip, after]);
    const put = (mediaId: string, media: 'image' | 'video') =>
      win.evaluate(
        (background) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setBackground', background } as never),
        { kind: 'media' as const, mediaId, media, fit: 'fill' as const, loop: media === 'video' },
      );

    // A picture up: LIVE and the hall show it.
    await put(beforeId, 'image');
    await expect.poll(() => shown(win, LIVE), { timeout: 20_000 }).toBe('BEFORE');
    await expect.poll(() => shown(hall, HALL), { timeout: 20_000 }).toBe('BEFORE');

    // A video whose file comes 3 s late: LIVE keeps the picture until the video's first frame, as the hall does.
    await put(clipId, 'video');
    heldLikeTheHall(await watchChange(win, hall, 'VIDEO'), 'BEFORE', 'VIDEO');

    // And back to a picture never shown before (it comes 3 s late too): LIVE keeps the video until it draws.
    await put(afterId, 'image');
    heldLikeTheHall(await watchChange(win, hall, 'AFTER'), 'VIDEO', 'AFTER');
  } finally {
    await app.close();
  }
});
