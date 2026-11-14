import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  windowShowing,
} from './helpers';
import { engineState, goLive, holdClock, makeSlides } from './placeholder-slides';

/*
 * The stream's own frames never show a slide before its pictures are drawn (Session 58, Q57-35). The stream's page
 * captures its own picture for the encoder (src/renderer/src/program/capture.ts: getDisplayMedia of its own page, frame
 * by frame); these tests capture it the same way and keep every frame's light. A slide drawn before its pictures have
 * loaded shows black where they go, then part of them: Session 57 found 1 to 5 such frames where Chromium draws without
 * a graphics chip (CI's Windows), with the first slide still loading as the stream's page came up. The hall's screens
 * load what Next shows ahead and never drew one. Generated pictures only: noise around a grey, 1920 x 1080, as large
 * as a show's pictures are.
 */

const STEP = 1000 / 60;

/** A picture of noise around one grey (0..255), the size of a show's picture; its light (0..1) is the grey's. */
async function drawNoise(page: Page, file: string, grey: number): Promise<string> {
  const base64 = await page.evaluate((grey) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const image = ctx.createImageData(1920, 1080);
    let seed = grey * 7919 + 17;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const v = Math.min(255, Math.max(0, grey - 24 + (seed % 49)));
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }, grey);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

interface Captured {
  /** When the page had it (its performance.now()). */
  t: number;
  /** Its light: the mean of every pixel's red, green and blue, 0 black .. 1 white. */
  mean: number;
}

/** Capture the stream's page as capture.ts does, keeping every frame's light in the page. */
async function captureOwnFrames(program: Page): Promise<void> {
  const why = await program.evaluate(async () => {
    const g = globalThis as unknown as { drashtiTestFrames?: Captured[] };
    const frames: Captured[] = [];
    g.drashtiTestFrames = frames;
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
    const canvas = new OffscreenCanvas(96, 54);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'no 2d context';
    void (async () => {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        ctx.drawImage(frame, 0, 0, 96, 54);
        frame.close();
        const d = ctx.getImageData(0, 0, 96, 54).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
        frames.push({ t: performance.now(), mean: sum / (96 * 54 * 3 * 255) });
      }
    })();
    return '';
  });
  expect(why, 'the stream’s page captures its own picture').toBe('');
}

const pageNow = (p: Page) => p.evaluate(() => performance.now());
const framesSince = (p: Page, from: number) =>
  p.evaluate(
    (from) =>
      ((globalThis as unknown as { drashtiTestFrames?: Captured[] }).drashtiTestFrames ?? []).filter(
        (f) => f.t >= from,
      ),
    from,
  );
const shown = (fs: Captured[], from: number) =>
  fs.map((f) => `${f.mean.toFixed(3)}@${String(Math.round(f.t - from))}`).join(' ');

/** Wait until `out` draws the slide layer at `p` of its transition (1: done). */
async function drawnAt(out: Page, p: number): Promise<void> {
  if (p >= 1) await expect(out.locator('[data-layer="slide"][data-fading="true"]')).toHaveCount(0);
  else await expect(out.locator('[data-layer="slide"]')).toHaveAttribute('data-fade', p.toFixed(3));
}

/**
 * The operator, the hall's screen and the stream's page, with these pictures imported (their media ids); `env`, more
 * test switches. With Chromium's word held back (DRASHTI_TEST_GPU_SAID=late) the hall's screen still warms up as the
 * stream's page opens, so it is not waited for.
 */
async function setUp(
  greys: number[],
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; win: Page; hall: Page; program: Page; ids: string[] }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1', ...env });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-pictures-'));
  const files: string[] = [];
  for (const [n, grey] of greys.entries())
    files.push(await drawNoise(win, join(dir, `Placeholder noise ${String(n)}.png`), grey));
  const ids = await importAndGetIds(win, files);
  await setUpScreen(win);
  const hall = await outputPage(app);
  if (env['DRASHTI_TEST_GPU_SAID'] !== 'late')
    await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await win.getByTestId('open-stream').click();
  const program = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
  await expect(program.getByTestId('program-root')).toBeVisible();
  return { app, win, hall, program, ids };
}

test('the stream’s page draws a slide already up as it comes up only with its pictures: a dissolve from it at once never starts on black (Q57-35)', async () => {
  test.setTimeout(180_000);
  // A dark picture and a bright one: through a dissolve from the dark to the bright the light only rises.
  const DARK = 54;
  const BRIGHT = 160;
  const { app, win, hall, program, ids } = await setUp([DARK, BRIGHT]);
  const [dark = '', bright = ''] = ids;
  const MS = 1000;
  const id = await makeSlides(win, 'Placeholder stream pictures', [{ picture: dark }, { picture: bright }], {
    kind: 'dissolve',
    durationMs: MS,
  });
  // Captured from before the first slide goes up, while the stream's page is still coming up.
  await captureOwnFrames(program);
  await holdClock(app, null);
  await goLive(win, id, 0);
  for (const out of [hall, program]) {
    await expect(out.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1, { timeout: 20_000 });
    await drawnAt(out, 1);
  }
  // At once, as Session 57's check did: the dissolve held at its very start, then drawn moment by moment.
  await holdClock(app, Date.now() - 60_000);
  const from = await pageNow(program);
  await goLive(win, id, 1);
  const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
  for (const i of [-2, -1, 0, 6, 15, 30, 45, 60, 78]) {
    const t = Math.round(i * STEP);
    await holdClock(app, shownAt + t);
    await drawnAt(program, Math.min(1, Math.max(0, t / MS)));
    await program.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
  }
  await holdClock(app, null);
  await drawnAt(program, 1);
  const frames = await framesSince(program, from);
  expect(frames.length, 'the stream’s page gave frames through the dissolve').toBeGreaterThan(0);
  // From the dark slide's own light up to the bright one's: a frame darker than the dark slide is black where its
  // picture goes, or part of it drawn.
  const floor = 0.85 * (DARK / 255);
  const off = frames.filter((f) => f.mean < floor);
  expect(
    off.length,
    `frames darker than the dark slide (${floor.toFixed(3)}) from going live with the dissolve (light@ms): ${shown(frames, from)}`,
  ).toBe(0);
  await app.close();
});

test('the stream’s page never cuts to a slide before its pictures are drawn: Next, and jumps to pictures it has not shown (Q57-35)', async () => {
  test.setTimeout(180_000);
  // Each picture its own grey, every two apart by more than the light a frame may be off.
  const GREYS = [40, 150, 90, 200, 120];
  const { app, win, program, ids } = await setUp(GREYS);
  const id = await makeSlides(
    win,
    'Placeholder stream cuts',
    ids.map((picture) => ({ picture })),
    { kind: 'cut', durationMs: 0 },
  );
  await captureOwnFrames(program);
  const level = (n: number) => (GREYS[n] ?? 0) / 255;
  /** The stream's newest frame is slide n's picture, whole. */
  const showing = async (n: number) => {
    await expect
      .poll(async () => (await framesSince(program, 0)).at(-1)?.mean ?? -1, { timeout: 20_000 })
      .toBeCloseTo(level(n), 1);
  };
  await holdClock(app, null);
  await goLive(win, id, 0);
  await expect(program.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1, { timeout: 20_000 });
  await showing(0);
  const lines: string[] = [];
  let off = 0;
  let now = 0;
  // Next (the slide after), then jumps: to slides it has not shown, and back.
  for (const next of [1, 3, 2, 4]) {
    const from = await pageNow(program);
    await goLive(win, id, next);
    await drawnAt(program, 1);
    await showing(next);
    const frames = await framesSince(program, from);
    // Every frame of a cut is the slide before or the new one, each whole: never black, nor part of a picture.
    const bad = frames.filter(
      (f) => Math.abs(f.mean - level(now)) > 0.03 && Math.abs(f.mean - level(next)) > 0.03,
    );
    off += bad.length;
    lines.push(`${String(now)}>${String(next)}: ${shown(frames, from)}`);
    now = next;
  }
  expect(off, `frames neither the slide before nor the new one, whole (light@ms): ${lines.join('; ')}`).toBe(
    0,
  );
  await app.close();
});

test('the stream’s page told it draws without a graphics chip after its warm-up began draws the slide up whole: a dissolve from it at once never starts on black (fault 2)', async () => {
  test.setTimeout(180_000);
  // Chromium's word on how it draws held back, as on a slow computer's start, and then: no graphics chip. The stream's
  // page opened before it warms up as with one (in software where there is none, as on CI's Windows); told, it stops.
  // Session 58 (h-black2): its first frames were then drawn with their tiles missing, black then 256-px parts, for up to
  // 3.3 s, the warm-up having used up the page's tile memory while the display compositor drew its frames (~0.8 s each).
  const DARK = 54;
  const BRIGHT = 160;
  const { app, win, hall, program, ids } = await setUp([DARK, BRIGHT], {
    DRASHTI_TEST_GPU_SAID: 'late',
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
  });
  const [dark = '', bright = ''] = ids;
  const MS = 1000;
  const id = await makeSlides(
    win,
    'Placeholder stream pictures told late',
    [{ picture: dark }, { picture: bright }],
    {
      kind: 'dissolve',
      durationMs: MS,
    },
  );
  // The stream's page warming up: drawing its scenes.
  await expect(program.locator('[data-testid="program-root"] [data-warm-up="during"]')).toHaveCount(1, {
    timeout: 60_000,
  });
  await captureOwnFrames(program);
  await holdClock(app, null);
  await goLive(win, id, 0);
  await letTimePass(program, 400, 'the warm-up still drawing when Chromium’s word comes');
  await app.evaluate(() => {
    (globalThis as { drashtiTestGpuSaid?: () => void }).drashtiTestGpuSaid?.();
  });
  await expect(program.getByTestId('program-root')).toHaveAttribute('data-warm-up', 'skipped');
  for (const out of [hall, program]) {
    await expect(out.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1, { timeout: 20_000 });
    await drawnAt(out, 1);
  }
  const drawn = await pageNow(program);
  // At once, as Session 57's check did: the dissolve held at its very start, then drawn moment by moment.
  await holdClock(app, Date.now() - 60_000);
  const from = await pageNow(program);
  await goLive(win, id, 1);
  const shownAt = (await engineState(win)).layers.slide?.shownAt ?? 0;
  for (const i of [-2, -1, 0, 6, 15, 30, 45, 60, 78]) {
    const t = Math.round(i * STEP);
    await holdClock(app, shownAt + t);
    await drawnAt(program, Math.min(1, Math.max(0, t / MS)));
    await program.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
  }
  await holdClock(app, null);
  await drawnAt(program, 1);
  const frames = await framesSince(program, drawn);
  // From the dark slide's own light up to the bright one's: a frame darker than the dark slide is black where its
  // picture goes, or part of it drawn. Counted from going live with the dissolve, as Session 57's check counted.
  const floor = 0.85 * (DARK / 255);
  const off = frames.filter((f) => f.t >= from && f.mean < floor);
  expect(
    off.length,
    `frames darker than the dark slide (${floor.toFixed(3)}) from going live with the dissolve (light@ms from the slide drawn): ${shown(frames, drawn)}`,
  ).toBe(0);
  // And once the stream showed the slide whole, it never showed it black or part-drawn again.
  const whole = frames.findIndex((f) => f.mean >= floor);
  const after = whole < 0 ? [] : frames.slice(whole).filter((f) => f.t < from && f.mean < floor);
  expect(
    after.length,
    `frames black or part-drawn after the slide showed whole: ${shown(frames, drawn)}`,
  ).toBe(0);
  await app.close();
});
