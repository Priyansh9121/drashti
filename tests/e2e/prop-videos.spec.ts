import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPages,
  setUpScreen,
} from './helpers';
import { makeTestVideo } from './test-media';

/*
 * A prop's video plays in step on every screen (Session 27, the skills review's MOT-6): the engine stamps
 * when the prop went up, and each screen plays its videos from then. Before, each window played them from
 * when it drew them, so a screen that opened later was behind by as much. A generated video only.
 */

async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

/** Where a page's prop video is, in seconds (or NaN), once it plays. */
const where = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('[data-layer="props"] video');
    return v && v.readyState >= 2 && !v.paused ? v.currentTime : Number.NaN;
  });

test('a prop’s video plays in step on a screen that opens after it went up', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-prop-video-'));
  const video = await makeTestVideo(win, join(dir, 'Placeholder prop clip.webm'), {
    seconds: 8,
    hue: 200,
    tone: 0,
  });
  const [mediaId = ''] = await importAndGetIds(win, [video]);
  const firstId = await setUpScreen(win, 'Main Hall', 0);
  const first = await outputFor(app, firstId);
  await expect(first.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await win.evaluate(async (mediaId) => {
    const shown = await (globalThis as PageGlobals).drashti.engine.dispatch({
      type: 'showProp',
      prop: {
        id: 'placeholder-prop',
        name: 'Placeholder video prop',
        elements: [
          {
            id: 'placeholder-prop-video',
            kind: 'video',
            mediaId,
            frame: { x: 1200, y: 60, width: 640, height: 360 },
            fit: 'fit',
            loop: true,
          },
        ],
      },
    });
    if (!shown.ok) throw new Error('the prop was refused');
  }, mediaId);
  await expect.poll(() => where(first), { timeout: 20_000 }).toBeGreaterThan(0);
  // Two seconds on, a second screen opens: it plays the video where the first one is, not from its start.
  await letTimePass(win, 2000, 'the prop’s video plays on before the second screen opens');
  const secondId = await setUpScreen(win, 'Side Hall', 1);
  const second = await outputFor(app, secondId);
  await expect.poll(() => where(second), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const [a, b] = [await where(first), await where(second)];
        return Math.abs(a - b);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(0.15);
  await app.close();
});
