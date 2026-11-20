import type { ElectronApplication, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, outputPages, outputReady, windowShowing } from './helpers';
import { decodePng } from './png-decode';
import { testFfmpeg } from './stream-helpers';
import { makeTestImage } from './test-media';

/*
 * What the hall, LIVE and the stream show, look by look and frame by frame (Q60-31, the owner's video bug; x46's
 * hunt): an orange test video, the green picture up before it and the blue wallpaper are told apart by their colour
 * in a page's own pixels, and each page's scene says by its markup, every frame, what it draws (the Wallpaper, a
 * picture, a video with its first frame in, or black). Generated media only (the bundled FFmpeg), placeholder names.
 */

export const OUT = '[data-testid="output-root"]';
export const LIVE = '[data-testid="live-preview"]';
export const PROGRAM = '[data-testid="program-root"]';

/** The test video's colour (orange), the picture up before it (green), the chosen wallpaper (blue). */
const VIDEO_RGB: [number, number, number] = [217, 72, 15];
const BEFORE_RGB: [number, number, number] = [20, 83, 45];
const WALL_RGB: [number, number, number] = [30, 58, 138];

export type Seen = 'VIDEO' | 'BEFORE' | 'WALL' | 'BLACK' | 'OTHER';

function seenOf(rgba: number[]): Seen {
  const near = (rgb: [number, number, number], within: number) =>
    rgb.every((c, i) => Math.abs((rgba[i] ?? -999) - c) <= within);
  if (near(VIDEO_RGB, 45)) return 'VIDEO';
  if (near(BEFORE_RGB, 40)) return 'BEFORE';
  if (near(WALL_RGB, 40)) return 'WALL';
  if (near([0, 0, 0], 12)) return 'BLACK';
  return 'OTHER';
}

/** What a page's scene shows at its middle, in its pixels (an output's, LIVE's). */
export async function shown(page: Page, root: string): Promise<Seen> {
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

export type Clip = 'h264' | 'h264-moov-at-end' | 'owner';

/**
 * A generated orange video of `seconds` with a tone: H.264 with its movie box first, or at the end; or the owner's
 * file's shape (H.264 Main 8-bit 1080p30 at a constant 17.8 Mb/s, AAC 48 kHz stereo 192 kb/s, the movie box at the end).
 */
export function makeClip(path: string, kind: Clip, seconds: number, hz = 440): string {
  const size = kind === 'owner' ? '1920x1080' : '320x180';
  const picture = ['-f', 'lavfi', '-i', `color=c=0xd9480f:s=${size}:r=30:d=${String(seconds)}`];
  const tone = ['-f', 'lavfi', '-i', `sine=f=${String(hz)}:r=48000:d=${String(seconds)}`];
  const coded =
    kind === 'owner'
      ? [
          '-c:v',
          'libx264',
          '-preset',
          'superfast',
          '-profile:v',
          'main',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '60',
          '-b:v',
          '17800k',
          '-minrate',
          '17800k',
          '-maxrate',
          '17800k',
          '-bufsize',
          '17800k',
          '-x264-params',
          'nal-hrd=cbr:force-cfr=1',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ac',
          '2',
        ]
      : [
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-g',
          '30',
          '-c:a',
          'aac',
          ...(kind === 'h264' ? ['-movflags', '+faststart'] : []),
        ];
  const r = spawnSync(
    testFfmpeg() ?? '',
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...picture, ...tone, ...coded, path],
    { timeout: 600_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return path;
}

const snapshot = async (win: Page) =>
  (await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot())).state;
export const dispatch = (win: Page, command: Record<string, unknown>) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** The background up now, in short: a file's id, or its kind, or none. */
export async function backgroundUp(win: Page): Promise<string> {
  const bg = (await snapshot(win)).layers.background;
  if (bg === null) return 'none';
  return bg.kind === 'media' ? bg.mediaId : bg.kind;
}

/** Whether any sound plays in the audio player now. */
export async function soundPlays(app: ElectronApplication): Promise<boolean> {
  const audio = app.windows().find((w) => w.url().includes('audio.html'));
  if (!audio) return false;
  return audio.evaluate(() =>
    [...document.querySelectorAll<HTMLMediaElement>('audio')].some((e) => !e.paused && e.currentTime > 0.05),
  );
}

interface HallRec {
  on: boolean;
  t0: number;
  frame: number;
  last: string;
  looks: string[];
}
interface HallGlobals {
  hallLook?: () => string;
  hallFail?: (mediaId: string) => boolean;
  hallRec?: HallRec;
}

/**
 * Each frame, what the page's scene draws by its own markup: Black-out (BLACKOUT), the Wallpaper (the cover, or
 * nothing up once its picture has come; WALL-COMING-OVER-PIC or -VIDEO while it comes over what is still drawn), a
 * background picture (PIC) or video (VIDEO; VIDEO-0x0 when it has no picture) ready and seen, or black (BLACK-LOADING
 * while it loads, BLACK-FAILED when it failed, BLACK-NOTHING-UP with no wallpaper, BLACK-WALL-COMING while the
 * wallpaper's picture comes over nothing). Kept as a list of changes, "<frame>f/<ms>ms:<look>", while recording.
 */
export async function installLooks(page: Page, root: string): Promise<void> {
  await page.evaluate((r) => {
    const g = globalThis as unknown as HallGlobals;
    const look = (): string => {
      const scene = document.querySelector(`${r} [data-testid="scene"]`);
      if (!scene) return 'NOSCENE';
      if (document.querySelector(`${r} [data-testid="blackout"]`)) return 'BLACKOUT';
      if (document.querySelector(`${r} [data-testid="wallpaper"]`)) return 'WALL';
      const nothing = scene.getAttribute('data-nothing-up');
      if (nothing === 'wallpaper') {
        // The wallpaper is drawn once its picture has come (Q60-31 (3)); until then, what is still drawn under it.
        const img = scene.querySelector(
          '[data-testid="wallpaper-picture"][data-wallpaper-role="current"] img',
        );
        if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) return 'WALL';
        // Its own black, drawn at once, covers the scene until its picture comes; unless kept out of sight meanwhile.
        const wall = scene.querySelector('[data-layer="wallpaper-picture"]');
        if (wall && getComputedStyle(wall).visibility !== 'hidden') return 'BLACK-WALL-COMING';
        const under = Array.from(scene.querySelectorAll<HTMLElement>('[data-bg-slot]')).filter(
          (e) => e.dataset['state'] !== 'loading' && Number(getComputedStyle(e).opacity) > 0.01,
        );
        if (under.some((e) => e instanceof HTMLVideoElement)) return 'WALL-COMING-OVER-VIDEO';
        return under.length > 0 ? 'WALL-COMING-OVER-PIC' : 'BLACK-WALL-COMING';
      }
      if (nothing === 'black') return 'BLACK-NOTHING-UP';
      const slots = Array.from(scene.querySelectorAll<HTMLElement>('[data-bg-slot]'));
      const seen = slots.filter(
        (e) => e.dataset['state'] === 'ready' && Number(getComputedStyle(e).opacity) > 0.01,
      );
      const video = seen.find((e) => e instanceof HTMLVideoElement);
      if (video instanceof HTMLVideoElement) return video.videoWidth === 0 ? 'VIDEO-0x0' : 'VIDEO';
      if (seen.length > 0) return 'PIC';
      return slots.some((e) => e.dataset['state'] === 'failed') ? 'BLACK-FAILED' : 'BLACK-LOADING';
    };
    g.hallLook = look;
    // An error on this page's video of that file, as the computer's decoder raises one: the element's own event.
    g.hallFail = (mediaId: string): boolean => {
      const v = document.querySelector<HTMLVideoElement>(
        `${r} video[data-bg-slot][data-media-id="${mediaId}"]`,
      );
      if (!v) return false;
      v.dispatchEvent(new Event('error'));
      return true;
    };
    g.hallRec = { on: false, t0: 0, frame: 0, last: '', looks: [] };
    const tick = (): void => {
      const rec = g.hallRec;
      if (rec?.on) {
        rec.frame += 1;
        const now = look();
        if (now !== rec.last) {
          rec.looks.push(`${String(rec.frame)}f/${String(Math.round(performance.now() - rec.t0))}ms:${now}`);
          rec.last = now;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, root);
}

export const domLook = (page: Page): Promise<string> =>
  page.evaluate(() => (globalThis as unknown as HallGlobals).hallLook?.() ?? 'no look');
export const failVideo = (page: Page, mediaId: string): Promise<boolean> =>
  page.evaluate((id) => (globalThis as unknown as HallGlobals).hallFail?.(id) ?? false, mediaId);
const recStart = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const rec = (globalThis as unknown as HallGlobals).hallRec;
    if (!rec) return;
    rec.on = true;
    rec.t0 = performance.now();
    rec.frame = 0;
    rec.last = '';
    rec.looks = [];
  });
const recStop = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const rec = (globalThis as unknown as HallGlobals).hallRec;
    if (!rec) return ['no recorder'];
    rec.on = false;
    return rec.looks;
  });
export const recAll = (pages: Page[]) => Promise.all(pages.map((p) => recStart(p)));
export const stopAll = (pages: Page[]) => Promise.all(pages.map((p) => recStop(p)));

/** Frames and ms a recording spent on `bad` looks before its first VIDEO (or to its end). */
export function before(looks: string[], bad: (look: string) => boolean): { frames: number; ms: number } {
  const all = looks.flatMap((s) => {
    const m = /^(\d+)f\/(\d+)ms:(.+)$/u.exec(s);
    return m ? [{ f: Number(m[1]), t: Number(m[2]), look: m[3] ?? '' }] : [];
  });
  let frames = 0;
  let ms = 0;
  for (let i = 0; i < all.length; i++) {
    const cur = all[i];
    if (!cur || cur.look === 'VIDEO') break;
    const next = all[i + 1];
    if (bad(cur.look) && next) {
      frames += next.f - cur.f;
      ms += next.t - cur.t;
    }
  }
  return { frames, ms };
}
/** Black of any kind but Black-out's own (BLACK-LOADING, BLACK-FAILED, BLACK-NOTHING-UP). */
export const isBlack = (look: string) => look.startsWith('BLACK-');

/** The operator window's notices now, in words. */
export const notices = (win: Page): Promise<string[]> =>
  win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="operator-notice"], [data-testid="import-notice"]'))
      .map((e) => e.textContent.trim().replace(/\s+/gu, ' '))
      .filter((t) => t !== ''),
  );

/** The audience screen, ready to draw (Drashti's pretend display, set by itself as the audience's), and its name. */
export async function audienceScreen(
  app: ElectronApplication,
  win: Page,
): Promise<{ page: Page; name: string }> {
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
  const id = await found.getByTestId('output-root').getAttribute('data-screen');
  const name = await win.evaluate(
    async (screenId) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups
        .flatMap((g) => g.screens)
        .find((s) => s.id === screenId)?.name ?? '',
    id,
  );
  return { page: found, name };
}

/** The stream's page drawing the Slides layout, as the Stream panel's preview asks for it (nothing goes live). */
export async function streamWatched(app: ElectronApplication, win: Page): Promise<Page> {
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
  const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(stream.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
    timeout: 60_000,
  });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
  await expect(stream.getByTestId('program-root')).toHaveAttribute('data-layout', 'slides');
  await installLooks(stream, PROGRAM);
  return stream;
}

/** A blue wallpaper chosen (what the screens show with nothing up) and a green picture to put up before the video. */
export async function wallpaperAndPicture(win: Page, dir: string): Promise<string> {
  const wall = await makeTestImage(win, join(dir, 'Placeholder wall.png'), {
    color: '#1e3a8a',
    width: 320,
    height: 180,
  });
  const picture = await makeTestImage(win, join(dir, 'Placeholder before.png'), {
    color: '#14532d',
    width: 320,
    height: 180,
  });
  const [wallId = '', beforeId = ''] = await importAndGetIds(win, [wall, picture]);
  await win.evaluate(async (id) => {
    const d = (globalThis as PageGlobals).drashti;
    const added = await d.wallpapers.add([id], null);
    if (!added.ok) throw new Error(added.message);
    const chosen = await d.wallpapers.choose(added.ids[0] ?? null);
    if (!chosen.ok) throw new Error(chosen.message);
  }, wallId);
  return beforeId;
}

export const showPicture = (win: Page, pictureId: string) =>
  dispatch(win, {
    type: 'setBackground',
    background: { kind: 'media', mediaId: pictureId, media: 'image', fit: 'fill', loop: false },
  });

/** The green picture up, alone, and seen on the hall. */
export async function pictureUp(win: Page, hall: Page, pictureId: string): Promise<void> {
  await dispatch(win, { type: 'clearAll' });
  await showPicture(win, pictureId);
  await expect
    .poll(() => shown(hall, OUT), { timeout: 40_000, message: 'the picture before' })
    .toBe('BEFORE');
}

/** A new playlist (empty, or of this media), open in the middle: its id, and its row's item id. */
export async function openNewPlaylist(
  win: Page,
  name: string,
  mediaId?: string,
): Promise<{ id: string; item: string }> {
  const made = await win.evaluate(
    async ({ name, mediaId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const list = await d.playlists.create(name, null, false);
      if (!list.ok) throw new Error(list.message);
      const id = list.ids[0] ?? '';
      if (mediaId === undefined) return { id, item: '' };
      const added = await d.playlists.addItems(id, null, [{ kind: 'media', mediaId }]);
      if (!added.ok) throw new Error(added.message);
      return { id, item: added.ids[0] ?? '' };
    },
    { name, mediaId },
  );
  await openPlaylist(win, name);
  return made;
}

export async function openPlaylist(win: Page, name: string): Promise<void> {
  await win.getByTestId('playlist-node').filter({ hasText: name }).first().click();
  await expect(win.getByTestId('playlist-title')).toHaveText(name);
}

export const row = (win: Page, itemId: string) =>
  win.getByTestId('open-playlist').locator(`[data-item-row="${itemId}"]`).getByTestId('playlist-item');

export interface Watched {
  looks: string[];
  off: boolean;
  blackWithSound: number;
  black: number;
  video: boolean;
}

/**
 * From now until `ms` (or until the hall and LIVE both show the video, when asked; or until the file is taken off):
 * each look, the hall's and LIVE's pixels, the sound, and whether the background is still that file.
 */
export async function watch(
  app: ElectronApplication,
  win: Page,
  hall: Page,
  mediaId: string,
  ms: number,
  untilVideo: boolean,
): Promise<Watched> {
  const looks: string[] = [];
  const until = Date.now() + ms;
  let off = false;
  let blackWithSound = 0;
  let black = 0;
  let video = false;
  const t0 = Date.now();
  for (;;) {
    const up = await backgroundUp(win);
    const plays = await soundPlays(app);
    const h = await shown(hall, OUT);
    const l = await shown(win, LIVE);
    const isUp = mediaId === '' ? up !== 'none' : up === mediaId;
    looks.push(
      `${String(Date.now() - t0)}ms H:${h} L:${l}${plays ? ' +sound' : ''}${isUp ? '' : ` (bg ${up})`}`,
    );
    if (h === 'BLACK' && isUp) black += 1;
    if (h === 'BLACK' && plays) blackWithSound += 1;
    if (h === 'VIDEO') video = true;
    if (!isUp && looks.length > 1) off = true;
    if (off || Date.now() > until) break;
    if (untilVideo && h === 'VIDEO' && l === 'VIDEO') break;
  }
  return { looks, off, blackWithSound, black, video };
}

/** Drashti's settings for these tests: a pretend display that sets itself as the audience's. */
export const SCREENS = {
  DRASHTI_TEST_AUTO_SCREENS: 'pretend',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_TEST_DISPLAY_CHANGES: '1',
};
