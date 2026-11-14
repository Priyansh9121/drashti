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
  type PageGlobals,
  setUpScreen,
  windowShowing,
} from './helpers';
import { engineState, goLive, holdClock, makeSlides } from './placeholder-slides';
import { streamPage, testFfmpeg } from './stream-helpers';

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

/** The operator, the hall's screen and the stream's page, with these pictures imported (their media ids). */
async function setUp(
  greys: number[],
): Promise<{ app: ElectronApplication; win: Page; hall: Page; program: Page; ids: string[] }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-pictures-'));
  const files: string[] = [];
  for (const [n, grey] of greys.entries())
    files.push(await drawNoise(win, join(dir, `Placeholder noise ${String(n)}.png`), grey));
  const ids = await importAndGetIds(win, files);
  await setUpScreen(win);
  const hall = await outputPage(app);
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

/**
 * Tests only (DRASHTI_TEST_STREAM_PROBE): the light of every frame the stream's page gave its encoder, kept as it went
 * (src/renderer/src/program/capture.ts): what the stream sends.
 */
const encoderFrames = (p: Page) =>
  p.evaluate(
    () => (globalThis as unknown as { drashtiTestEncoderFrames?: Captured[] }).drashtiTestEncoderFrames ?? [],
  );

/** Recording begun, into a folder of the test's own: the stream's encoder at work, never sending to the internet. */
async function record(app: ElectronApplication, win: Page): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-start-'));
  await app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
  }, dir);
  const began = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const folder = await d.stream.pickFolder();
    if (!folder.ok) return folder.message;
    const r = await d.stream.startRecording();
    return r.ok ? 'ok' : r.message;
  });
  expect(began, 'recording begun').toBe('ok');
}

const stopRecording = (win: Page) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording());

test('the stream starts from the first frame that shows the show: recording begun as its page comes up, a slide up, every frame its encoder gets is the slide whole, never the page’s own black (Session 58)', async () => {
  // CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
  test.skip(
    !testFfmpeg() && !process.env['CI'],
    'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs',
  );
  test.setTimeout(180_000);
  // Without a graphics chip, so neither system warms the stream's page up: it comes up as fast as it can.
  const DARK = 54;
  const { app } = await launchApp({
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_TEST_STREAM_PROBE: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-pictures-'));
  const [picture = ''] = await importAndGetIds(win, [
    await drawNoise(win, join(dir, 'Placeholder noise start.png'), DARK),
  ]);
  const id = await makeSlides(win, 'Placeholder stream start', [{ picture }], { kind: 'cut', durationMs: 0 });
  await goLive(win, id, 0);
  // Nothing has the stream's page open: the recording opens it, and its encoder is given the page as it loads.
  await record(app, win);
  const program = await streamPage(app);
  await expect
    .poll(async () => (await encoderFrames(program)).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(15);
  const frames = await encoderFrames(program);
  const level = DARK / 255;
  // Every frame the stream sends, its first among them, is the slide whole: never black before it, nor part of it.
  const off = frames.filter((f) => Math.abs(f.mean - level) > 0.03);
  expect(
    off.length,
    `frames the encoder got that were not the slide whole (light@ms from the first): ${shown(frames, frames[0]?.t ?? 0)}`,
  ).toBe(0);
  expect((await stopRecording(win)).ok, 'recording stopped').toBe(true);
  await app.close();
});

test('the stream’s page told it draws without a graphics chip after its warm-up began: every frame the stream sends is the slide up whole, or a dissolve from it begun at once, never black nor part of it (fault 2)', async () => {
  test.skip(
    !testFfmpeg() && !process.env['CI'],
    'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs',
  );
  test.setTimeout(180_000);
  // Chromium's word on how it draws held back, as on a slow computer's start, and then: no graphics chip. The stream's
  // page, opened before then by the recording, warms up as with one (in software where there is none, as on CI's
  // Windows); told, it stops. Session 58 (h-black2): its first frames were then drawn with their tiles missing, black then
  // 256-px parts, for 1.6 to 3.3 s after the page had drawn the slide (now and then a whole frame followed by a black or
  // part-drawn one), the warm-up having used up the page's tile memory while the display compositor drew its frames
  // (~0.8 s each); and the stream sent the page's own black as it came up. Recording and the next slide each begin as
  // early as Drashti lets them: the recording before the page is open, the dissolve as soon as the page draws the slide.
  const DARK = 54;
  const BRIGHT = 160;
  const { app } = await launchApp({
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_CLOCK_HOLD: '1',
    DRASHTI_TEST_GPU_SAID: 'late',
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
    DRASHTI_TEST_STREAM_PROBE: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-stream-pictures-'));
  const ids = await importAndGetIds(win, [
    await drawNoise(win, join(dir, 'Placeholder noise told 0.png'), DARK),
    await drawNoise(win, join(dir, 'Placeholder noise told 1.png'), BRIGHT),
  ]);
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
  await setUpScreen(win);
  const hall = await outputPage(app);
  await record(app, win);
  const program = await streamPage(app);
  // The stream's page warming up: drawing its scenes.
  await expect(program.locator('[data-testid="program-root"] [data-warm-up="during"]')).toHaveCount(1, {
    timeout: 60_000,
  });
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
  await expect
    .poll(async () => (await encoderFrames(program)).filter((f) => f.t >= from).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const frames = await encoderFrames(program);
  // From the dark slide's own light up to the bright one's: a frame darker than the dark slide is black, or part of a
  // picture drawn. Every frame the stream sent, from its first.
  const floor = 0.85 * (DARK / 255);
  const off = frames.filter((f) => f.mean < floor);
  expect(
    off.length,
    `frames the encoder got darker than the dark slide (${floor.toFixed(3)}) (light@ms from going live with the dissolve): ${shown(frames, from)}`,
  ).toBe(0);
  expect((await stopRecording(win)).ok, 'recording stopped').toBe(true);
  await app.close();
});
