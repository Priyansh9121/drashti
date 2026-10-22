import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cocoaRtf, pp6Presentation } from '../../src/main/import/testing/pp6-fixtures';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage, outputPage, setUpScreen } from './helpers';
import { makeTestVideo } from './test-media';

/*
 * A GPU process crash (Sessions 31–36, ROB-5). The method: Chromium's own GPU-crash page, loaded in a window
 * of Drashti's own that is never shown (Electron allows it from the main process). Chromium starts a new GPU
 * process by itself; a video background that failed with the old one is tried again at the engine's time.
 */

/** Crash the GPU process, and wait for Chromium to say so. */
async function crashGpu(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ app: electronApp, BrowserWindow }) =>
      new Promise<void>((resolve) => {
        const gone = (_e: unknown, details: { type: string }) => {
          if (details.type !== 'GPU') return;
          electronApp.removeListener('child-process-gone', gone);
          resolve();
        };
        electronApp.on('child-process-gone', gone);
        const w = new BrowserWindow({ show: false });
        void w.webContents.loadURL('chrome://gpucrash').catch(() => undefined);
        setTimeout(() => {
          if (!w.isDestroyed()) w.destroy();
        }, 5000);
      }),
  );
}

/** The background video's time now, and whether it plays: -1 when it is not there or has failed. */
const videoNow = (output: Page, mediaId: string) =>
  output.evaluate((id) => {
    const v = document.querySelector<HTMLVideoElement>(
      `[data-layer="background"] video[data-media-id="${id}"]`,
    );
    if (!v || v.dataset['state'] === 'failed' || v.error) return -1;
    return v.currentTime;
  }, mediaId);

/** How far it plays in half a second (wrapping at its end), or -1. */
async function playsOn(output: Page, mediaId: string): Promise<number> {
  const before = await videoNow(output, mediaId);
  // eslint-disable-next-line no-restricted-syntax -- how far the video plays in this long
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await videoNow(output, mediaId);
  if (before < 0 || after < 0) return -1;
  return after - before;
}

test('a GPU crash leaves a video background playing again, at the engine’s time', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-gpu-'));
  // H.264, decoded in the GPU process as the mandir's own videos are; long enough to play through the test.
  const loop = await makeTestVideo(win, join(dir, 'Placeholder loop.mp4'), {
    seconds: 12,
    hue: 140,
    h264: true,
    width: 1280,
    height: 720,
  });
  const show = join(dir, 'Placeholder GPU.pro6');
  writeFileSync(
    show,
    pp6Presentation({
      uuid: 'E2E-GPU-CRASH',
      groups: [
        {
          name: 'Verse',
          slides: [
            {
              background: { path: loop, kind: 'video', loop: true },
              text: [{ rtf: cocoaRtf([['Placeholder GPU line', 80, [255, 255, 255]]]) }],
            },
          ],
        },
      ],
    }),
  );
  const [presentationId = ''] = await importAndGetIds(win, [show]);
  const mediaId = await win.evaluate(async (id) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(id);
    // Its background video's file (a video input, Session 51, has none).
    for (const cue of doc?.groups[0]?.slides[0]?.cues ?? [])
      if (cue.kind === 'background' && cue.background.kind === 'media') return cue.background.mediaId;
    return '';
  }, presentationId);
  await setUpScreen(win);
  const output = await outputPage(app);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );
  const video = output.locator(`[data-layer="background"] video[data-media-id="${mediaId}"]`);
  await expect(video).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => playsOn(output, mediaId), { timeout: 10_000 }).toBeGreaterThan(0.3);

  await crashGpu(app);
  // Within 5 s it plays again, where the engine's clock says it should be.
  await expect
    .poll(() => playsOn(output, mediaId), { timeout: 5_000, intervals: [250] })
    .toBeGreaterThan(0.3);
  const startedAt = await win.evaluate(async () => {
    const layer = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background;
    return layer?.kind === 'media' ? layer.startedAt : null;
  });
  const at = await output.evaluate((id) => {
    const v = document.querySelector<HTMLVideoElement>(
      `[data-layer="background"] video[data-media-id="${id}"]`,
    );
    return v ? { time: v.currentTime, duration: v.duration, now: Date.now() } : null;
  }, mediaId);
  expect(at).not.toBeNull();
  expect(startedAt).not.toBeNull();
  const due = (((at?.now ?? 0) - (startedAt ?? 0)) / 1000) % (at?.duration ?? 1);
  expect(
    Math.abs((at?.time ?? 0) - due),
    `video at ${String(at?.time)} s, due at ${String(due)} s`,
  ).toBeLessThan(0.5);

  // A second stop within 10 minutes: it plays again, and the operator is told, once.
  await crashGpu(app);
  await expect
    .poll(() => playsOn(output, mediaId), { timeout: 5_000, intervals: [250] })
    .toBeGreaterThan(0.3);
  await expect(
    win.getByRole('alert').filter({ hasText: 'The screens’ graphics stopped twice in 10 minutes' }),
  ).toBeVisible();
  await app.close();
});
