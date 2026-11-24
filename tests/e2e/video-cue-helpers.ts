import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  windowShowing,
} from './helpers';
import { audioPage, snapshot } from './time-bar-helpers';
import { makeTestVideo } from './test-media';

/**
 * The cost spec's position sweeps (QA23-FADE-9), one for each of setupVideoCue's two videos in their order, each in
 * its own band beside its tone (440 and 880 Hz), and where the reader looks for them.
 */
export const COST_SWEEPS = [
  { from: 2000, perSecond: 500, level: 0.1 },
  { from: 7000, perSecond: 500, level: 0.1 },
] as const;
export const COST_BANDS = [
  { lo: 1900, hi: 6300 },
  { lo: 6900, hi: 11_300 },
] as const;

export async function setupVideoCue(software = false, sweeps = false) {
  const { app } = await launchApp(
    { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_FAKE_DEVICES: '1' },
    undefined,
    {},
    software ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-video-decode'] : [],
  );
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-s5-'));
    const dimensions = software ? { width: 1920, height: 1080 } : {};
    const a = await makeTestVideo(win, join(dir, 'Placeholder red.webm'), {
      seconds: 8,
      hue: 0,
      tone: 440,
      ...(sweeps ? { sweep: COST_SWEEPS[0] } : {}),
      ...dimensions,
    });
    const b = await makeTestVideo(win, join(dir, 'Placeholder blue.webm'), {
      seconds: 8,
      hue: 240,
      tone: 880,
      ...(sweeps ? { sweep: COST_SWEEPS[1] } : {}),
      ...dimensions,
    });
    const ids = await importAndGetIds(win, [a, b]);
    await setUpScreen(win, 'Main Hall', 0);
    const hall = await outputPage(app);
    await outputReady(hall);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.watchPreview(true));
    const stream = await windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');
    await expect(stream.getByTestId('program-root')).toBeVisible();
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.setLayout('slides'));
    return { app, win, hall, stream, audio: await audioPage(app), ids, dir };
  } catch (error) {
    await app.close();
    throw error;
  }
}

export async function cueReady(win: Page) {
  let last: Awaited<ReturnType<typeof snapshot>>['videoCue'] = null;
  try {
    await expect
      .poll(
        async () => {
          const cue = (await snapshot(win)).videoCue;
          last = cue;
          return !!cue && !cue.error && cue.required.every((id) => cue.ready.includes(id));
        },
        { message: 'Every required playing page must acknowledge this exact first frame' },
      )
      .toBe(true);
  } catch (error) {
    await test.info().attach('s5-cue-readiness.json', {
      body: Buffer.from(JSON.stringify(last)),
      contentType: 'application/json',
    });
    throw error;
  }
}
