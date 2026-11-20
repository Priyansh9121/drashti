import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, operatorReady, outputPages, outputReady } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * "Plays anything" (alpha.20: the owner's Q60-34 item 2, and his "Yes, all A" to Q60-39, P6 (b)): what comes in either
 * plays on the screens as it is, or is converted by itself first, never going up as it is. The kinds the bug hunt found
 * going up and never drawn (x46's probe x46-1120-112649-63694, both systems): an 8K H.264, judged by FFmpeg at import
 * and by the file's header alone (as a library from before Session 50 judged it); the lead's call: above 4096 × 2304 it
 * is converted to a 2160p copy. And an interlaced video, converted by itself into a smooth progressive copy (P6 (b) A).
 * Generated media only (FFmpeg's test sources, made here), placeholder names.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): string {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    timeout: 180_000,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return args.at(-1) ?? '';
}

/** 2 s of H.264 at 10 a second, `size`, with a tone; interlaced (top field first) when asked. */
const clip = (file: string, size: string, interlaced = false) =>
  ff([
    ...['-f', 'lavfi', '-i', `testsrc2=s=${size}:r=10:d=2`],
    ...['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=2'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
    ...(interlaced ? ['-flags', '+ildct+ilme', '-x264-params', 'tff=1'] : []),
    ...['-c:a', 'aac', '-shortest', file],
  ]);

async function start(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page }> {
  const { app } = await launchApp({ DRASHTI_TEST_AUTO_SCREENS: 'pretend', ...env });
  const win = await operatorPage(app);
  await operatorReady(win);
  return { app, win };
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

/** What the library's Media says of a file: why it cannot play as it is, or null. */
const unplayableOf = (win: Page, mediaId: string) =>
  win.evaluate(async (id) => {
    const all = await (globalThis as PageGlobals).drashti.library.listMedia();
    return all.find((m) => m.id === id)?.unplayable ?? null;
  }, mediaId);

/** The conversion of a file once it is done: the copy everything uses now. */
async function convertedCopy(win: Page, mediaId: string): Promise<string> {
  let copy = '';
  await expect
    .poll(
      async () => {
        const jobs = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.conversions());
        const job = jobs.find((j) => j.mediaId === mediaId);
        copy = job?.convertedId ?? '';
        return job?.state ?? 'none';
      },
      { timeout: 240_000, message: 'converted by itself' },
    )
    .toBe('done');
  return copy;
}

/** What FFmpeg reads in a file's first picture (Media information's own reading). */
const pictureOf = (win: Page, mediaId: string) =>
  win.evaluate(async (id) => {
    const result = await (globalThis as PageGlobals).drashti.media.details(id);
    const p = result.ok ? result.details.read?.pictures[0] : undefined;
    return p ? { width: p.width, height: p.height, scan: p.scan } : null;
  }, mediaId);

/** The file up as the background, drawn on the audience screen: its picture there, decoded, not 0 × 0. */
async function drawsOnTheHall(win: Page, hall: Page, mediaId: string): Promise<void> {
  const put = await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'setBackground',
        background: { kind: 'media', mediaId: id, media: 'video', fit: 'fit', loop: true },
      }),
    mediaId,
  );
  expect(put.ok).toBe(true);
  await expect
    .poll(
      () =>
        hall.evaluate((id) => {
          const v = document.querySelector<HTMLVideoElement>(`video[data-bg-slot][data-media-id="${id}"]`);
          return v ? `${v.dataset['state'] ?? ''} ${String(v.videoWidth)}x${String(v.videoHeight)}` : 'none';
        }, mediaId),
      { timeout: 30_000, message: 'its picture drawn on the audience screen' },
    )
    .toMatch(/^ready [1-9]\d*x[1-9]\d*$/u);
}

test('an 8K H.264, read by FFmpeg at import: converted by itself to a 2160p copy, never up as it is, and the copy draws on the hall', async () => {
  test.setTimeout(420_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-plays-anything-'));
  const { app, win } = await start();
  try {
    const hall = await audienceScreen(app);
    const [id = ''] = await importAndGetIds(win, [clip(join(dir, 'Placeholder 8K clip.mp4'), '7680x4320')]);
    expect(id).not.toBe('');
    // Never up as it is: Media says why, by its size.
    expect(await unplayableOf(win, id)).toMatch(/7680 × 4320/u);
    const copy = await convertedCopy(win, id);
    expect(await pictureOf(win, copy)).toEqual({ width: 3840, height: 2160, scan: 'progressive' });
    await drawsOnTheHall(win, hall, copy);
  } finally {
    await app.close();
  }
});

test('an 8K H.264 judged by its header alone (as a library from before Session 50): it cannot go up as it is, and says why', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-plays-anything-'));
  const { app, win } = await start({ DRASHTI_TEST_NO_CONVERT_AT_IMPORT: '1' });
  try {
    const [id = ''] = await importAndGetIds(win, [clip(join(dir, 'Placeholder 8K header.mp4'), '7680x4320')]);
    expect(id).not.toBe('');
    expect(await unplayableOf(win, id)).toMatch(/7680 × 4320/u);
  } finally {
    await app.close();
  }
});

test('an interlaced H.264: converted by itself into a progressive copy, never up as it is, and the copy draws on the hall', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-plays-anything-'));
  const { app, win } = await start();
  try {
    const hall = await audienceScreen(app);
    const [id = ''] = await importAndGetIds(win, [
      clip(join(dir, 'Placeholder 1080i clip.mp4'), '640x360', true),
    ]);
    expect(id).not.toBe('');
    expect(await pictureOf(win, id)).toMatchObject({ scan: 'top first' });
    expect(await unplayableOf(win, id)).toMatch(/interlaced/u);
    const copy = await convertedCopy(win, id);
    expect(await pictureOf(win, copy)).toEqual({ width: 640, height: 360, scan: 'progressive' });
    await drawsOnTheHall(win, hall, copy);
  } finally {
    await app.close();
  }
});
