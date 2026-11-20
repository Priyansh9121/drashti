import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_PLAYBACK_SETTINGS } from '../../src/shared/playback-settings';
import { DEFAULT_PIP_PLACE } from '../../src/shared/pip';
import type { VideoShape } from '../../src/shared/video-shape';
import {
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  type PageGlobals,
  windowShowing,
} from './helpers';
import { decodePng } from './png-decode';
import { testFfmpeg } from './stream-helpers';
import { dispatch } from './time-bar-helpers';

/*
 * Sound and picture…'s Shape (alpha.20, x55, slice 6b; the owner's Q60-34 and his "Yes, all A" to Q60-39 P6 (c) A): a
 * 640 × 480 video (4:3, square pixels) of a white circle on blue, set to 16:9 in its window, is drawn 16:9 with its
 * circle 1.33 times as wide as tall, in pixels: on the audience screen, in LIVE and in the stream's own picture (its
 * page's capture of itself, as its encoder gets it; nothing is sent anywhere); 21:9 fitted bars it above and below, the
 * circle 1.75 times as wide; As the file says puts it back. In the picture-in-picture box the same. Generated media
 * only. (A slide's video comes with SlideView's part, after L8: N/reports/x55-slide-part.)
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

const HALL = '[data-testid="output-root"] [data-testid="scene"]';
const LIVE = '[data-testid="live-preview"] [data-testid="scene"]';
const BOX = '[data-testid="output-root"] [data-testid="pip-box"] [data-pip-frame]';

/** How a video is drawn: its box (every pixel not black) and its circle (white), each as width over height. */
interface Drawn {
  box: number;
  circle: number;
}

/** As the file says: 4:3, the circle round. */
const AS_THE_FILE: Drawn = { box: 4 / 3, circle: 1 };
/** Set to 16:9: the whole 16:9 screen (or box), the circle stretched to 16:9 over 4:3. */
const WIDE: Drawn = { box: 16 / 9, circle: 16 / 9 / (4 / 3) };
/** Set to 21:9, fitted on a 16:9 screen: bars above and below. */
const CINEMA: Drawn = { box: 21 / 9, circle: 21 / 9 / (4 / 3) };

/** The circle's picture: a white circle 240 across in the middle of 640 × 480 of blue, well clear of black and white. */
async function circlePicture(page: Page, file: string): Promise<string> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#2a64d8';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(320, 240, 120, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** That picture as 20 s of H.264 video, 640 × 480 with square pixels: a 4:3 video, no sound. */
function circleVideo(picture: string, file: string): string {
  const r = spawnSync(
    ffmpeg ?? '',
    [
      ...['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'],
      ...['-loop', '1', '-framerate', '25', '-i', picture, '-t', '20'],
      ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file],
    ],
    { timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return file;
}

type Rgb = readonly [number, number, number];

/** How many pixels from the first that is so to the last (0: none). */
function span(line: readonly Rgb[], is: (c: Rgb) => boolean): number {
  const first = line.findIndex(is);
  if (first < 0) return 0;
  let last = line.length - 1;
  while (last > first && !is(line[last] ?? [0, 0, 0])) last--;
  return last - first + 1;
}

/** The video's box: anything but black. */
const lit = (c: Rgb) => Math.max(c[0], c[1], c[2]) > 60;
/** Its circle: white. */
const white = (c: Rgb) => Math.min(c[0], c[1], c[2]) > 190;

/** How a video is drawn, from the middle row and the middle column of its place. */
function drawnAlong(row: readonly Rgb[], column: readonly Rgb[]): Drawn | null {
  const [bw, bh, cw, ch] = [span(row, lit), span(column, lit), span(row, white), span(column, white)];
  return bw > 0 && bh > 0 && cw > 0 && ch > 0 ? { box: bw / bh, circle: cw / ch } : null;
}

/** How the video in an element's place in a page is drawn (CSS pixels), from a screenshot. */
async function drawnOn(page: Page, selector: string): Promise<Drawn | null> {
  const r = await page.locator(selector).first().boundingBox();
  if (!r || r.width < 16 || r.height < 16) return null;
  const { width, height, rgba } = decodePng(await page.screenshot({ scale: 'css' }));
  const at = (x: number, y: number): Rgb => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
    return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
  };
  const [x0, x1] = [Math.ceil(r.x), Math.floor(r.x + r.width) - 1];
  const [y0, y1] = [Math.ceil(r.y), Math.floor(r.y + r.height) - 1];
  const [cx, cy] = [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
  return drawnAlong(
    Array.from({ length: x1 - x0 + 1 }, (_, i) => at(x0 + i, cy)),
    Array.from({ length: y1 - y0 + 1 }, (_, i) => at(cx, y0 + i)),
  );
}

interface Lines {
  row: Rgb[];
  column: Rgb[];
}

/**
 * The stream's own picture as its encoder gets it (src/renderer/src/program/capture.ts: its page's capture of itself),
 * its middle row and column kept five times a second.
 */
async function watchTheStream(program: Page): Promise<void> {
  const why = await program.evaluate(async () => {
    const g = globalThis as unknown as { drashtiTestShapeLines?: Lines };
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1920, height: 1080, frameRate: 30 },
      audio: false,
    });
    const track = display.getVideoTracks()[0];
    if (!track) return 'no video track';
    // The browser's own frame reader (the e2e project's types know nothing of it; capture.ts's do).
    interface Reader {
      read(): Promise<{ value?: VideoFrame; done: boolean }>;
    }
    const Processor = (
      globalThis as unknown as {
        MediaStreamTrackProcessor: new (o: { track: MediaStreamTrack }) => {
          readable: { getReader(): Reader };
        };
      }
    ).MediaStreamTrackProcessor;
    const reader = new Processor({ track }).readable.getReader();
    const [w, h] = [960, 540];
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'no 2d context';
    const rgb = (d: Uint8ClampedArray): Rgb[] =>
      Array.from({ length: d.length / 4 }, (_, i) => [d[i * 4] ?? 0, d[i * 4 + 1] ?? 0, d[i * 4 + 2] ?? 0]);
    let kept = 0;
    void (async () => {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        if (performance.now() - kept >= 200) {
          kept = performance.now();
          ctx.drawImage(frame, 0, 0, w, h);
          g.drashtiTestShapeLines = {
            row: rgb(ctx.getImageData(0, h / 2, w, 1).data),
            column: rgb(ctx.getImageData(w / 2, 0, 1, h).data),
          };
        }
        frame.close();
      }
    })();
    return '';
  });
  expect(why, 'the stream’s page captures its own picture').toBe('');
}

/** How the video is drawn in the stream's picture, as last kept. */
async function drawnOnTheStream(program: Page): Promise<Drawn | null> {
  const lines = await program.evaluate(
    () => (globalThis as unknown as { drashtiTestShapeLines?: Lines }).drashtiTestShapeLines ?? null,
  );
  return lines ? drawnAlong(lines.row, lines.column) : null;
}

const said = (d: Drawn | null) =>
  d ? `box ${d.box.toFixed(3)}, circle ${d.circle.toFixed(3)}` : 'nothing of it';

/** Until it is drawn as wanted, within `within` (each ratio), else the last drawing said. */
async function expectDrawn(
  get: () => Promise<Drawn | null>,
  want: Drawn,
  within: number,
  where: string,
  timeout = 15_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const d = await get();
        return d && Math.abs(d.box - want.box) <= within && Math.abs(d.circle - want.circle) <= within
          ? 'as wanted'
          : said(d);
      },
      { timeout, message: `${where}: ${said(want)}` },
    )
    .toBe('as wanted');
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

/** Drashti with its audience screen, and the circle's video in Media (its id). */
async function setUp(): Promise<{ app: ElectronApplication; win: Page; hall: Page; id: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-video-shape-'));
  const { app } = await launchApp({
    DRASHTI_TEST_AUTO_SCREENS: 'pretend',
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_DISPLAY_CHANGES: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const hall = await audienceScreen(app);
  const clip = circleVideo(
    await circlePicture(win, join(dir, 'Placeholder circle.png')),
    join(dir, 'Placeholder shape clip.mp4'),
  );
  const [id = ''] = await importAndGetIds(win, [clip]);
  expect(id).not.toBe('');
  return { app, win, hall, id };
}

/** Its Shape kept as Sound and picture… keeps it (the window's own call). */
async function keepShape(win: Page, id: string, shape: VideoShape): Promise<void> {
  const kept = await win.evaluate(
    ({ v, settings }) => (globalThis as PageGlobals).drashti.media.setPlayback(v, settings),
    { v: id, settings: { ...NO_PLAYBACK_SETTINGS, shape } },
  );
  expect(kept.ok).toBe(true);
}

/** Its Shape chosen in Sound and picture…, from its right-click menu in Media; kept before the window is closed. */
async function chooseShape(win: Page, id: string, shape: VideoShape): Promise<void> {
  await openLibrary(win);
  await win.getByTestId('library-tab-media').click();
  await win
    .getByTestId('media-item')
    .filter({ hasText: 'Placeholder shape clip' })
    .click({ button: 'right' });
  await win.getByRole('menuitem', { name: 'Sound and picture…' }).click();
  const dialog = win.getByTestId('sound-picture');
  await dialog.getByLabel('Shape').selectOption(shape);
  await expect
    .poll(
      async () =>
        (await win.evaluate((v) => (globalThis as PageGlobals).drashti.media.playback(v), id))?.shape,
    )
    .toBe(shape);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await closeLibrary(win);
}

test('a 4:3 video set to 16:9 in Sound and picture… is drawn 16:9 on the audience screen, in LIVE and in the stream’s picture, its circle 1.33 times as wide as tall; 21:9 bars it above and below; As the file says puts it back', async () => {
  test.setTimeout(240_000);
  const { app, win, hall, id } = await setUp();
  try {
    // The stream's own picture, as the Stream panel's preview asks for it (nothing is sent anywhere).
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
    const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(program.getByTestId('program-root')).toHaveAttribute('data-fonts', 'ready', {
      timeout: 30_000,
    });
    await watchTheStream(program);
    expect(
      (
        await dispatch(win, {
          type: 'setBackground',
          background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
        })
      ).ok,
    ).toBe(true);

    // As the file says: 4:3 with bars at the sides, the circle round, everywhere.
    await expectDrawn(() => drawnOn(hall, HALL), AS_THE_FILE, 0.04, 'the audience screen', 30_000);
    await expectDrawn(() => drawnOn(win, LIVE), AS_THE_FILE, 0.08, 'LIVE');
    await expectDrawn(() => drawnOnTheStream(program), AS_THE_FILE, 0.04, 'the stream', 30_000);

    // 16:9: the whole screen, the circle 1.33 times as wide as tall.
    await chooseShape(win, id, '16:9');
    await expectDrawn(() => drawnOn(hall, HALL), WIDE, 0.04, 'the audience screen at 16:9');
    await expectDrawn(() => drawnOn(win, LIVE), WIDE, 0.08, 'LIVE at 16:9');
    await expectDrawn(() => drawnOnTheStream(program), WIDE, 0.04, 'the stream at 16:9');

    // 21:9, fitted: bars above and below, the circle 1.75 times as wide as tall.
    await chooseShape(win, id, '21:9');
    await expectDrawn(() => drawnOn(hall, HALL), CINEMA, 0.05, 'the audience screen at 21:9');

    // As the file says again.
    await chooseShape(win, id, 'file');
    await expectDrawn(
      () => drawnOn(hall, HALL),
      AS_THE_FILE,
      0.04,
      'the audience screen as the file says again',
    );
  } finally {
    await app.close();
  }
});

test('in the picture-in-picture box, a 4:3 video set to 16:9 fills the 16:9 box, its circle 1.33 times as wide as tall', async () => {
  test.setTimeout(180_000);
  const { app, win, hall, id } = await setUp();
  try {
    expect(
      (
        await dispatch(win, {
          type: 'showPip',
          source: { kind: 'media', mediaId: id },
          // No border or rounded corners: only the video and the box's black inside it.
          place: { ...DEFAULT_PIP_PLACE, size: 'large', border: false, rounded: false },
        })
      ).ok,
    ).toBe(true);
    await expectDrawn(() => drawnOn(hall, BOX), AS_THE_FILE, 0.05, 'the box as the file says', 30_000);
    await keepShape(win, id, '16:9');
    await expectDrawn(() => drawnOn(hall, BOX), WIDE, 0.05, 'the box at 16:9');
  } finally {
    await app.close();
  }
});
