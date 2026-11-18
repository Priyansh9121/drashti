import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady } from './helpers';

/*
 * The stream's page's warm-up at Drashti's start (Session 59, X21; C19's finding): once the start has settled, Main
 * opens the stream's warm-up page alone, off screen in a window like the stream's, so the drawing pipelines it makes
 * exist before the stream's page is ever opened on air (made then, they stalled the hall's screens). It closes when
 * done. Never where Chromium draws without a graphics chip, and in a test only when it asks
 * (DRASHTI_TEST_STREAM_WARM=1). How Main reads Chromium's gpu_compositing is set by a test switch (warm-up.spec.ts).
 */

const ASK = { DRASHTI_TEST_STREAM_WARM: '1' };
const WITH_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'enabled' };
const WITHOUT_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' };

/** What Drashti's log has said of the start's stream warm-up, each line from its "Stream warm-up:". */
function streamWarmLines(userData: string): string[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes('Stream warm-up: '))
    .map((line) => line.slice(line.indexOf('Stream warm-up: ')).trimEnd());
}

/** The windows whose page is the stream's warm-up page. */
const warmWindows = (app: Awaited<ReturnType<typeof launchApp>>['app']) =>
  app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter(
        (w) => !w.isDestroyed() && w.webContents.getURL().includes('stream-warm.html'),
      ).length,
  );

test('with a graphics chip, the stream’s warm-up page runs once the start has settled, off screen, and closes when done', async () => {
  test.setTimeout(90_000);
  const { app, userData } = await launchApp({ ...ASK, ...WITH_A_CHIP });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect
      .poll(() => streamWarmLines(userData), { timeout: 45_000 })
      .toEqual(
        expect.arrayContaining([
          'Stream warm-up: the stream’s page’s warm-up, alone, off screen',
          expect.stringMatching(/^Stream warm-up: done in \d+\.\d s$/u),
        ]),
      );
    // Done by its own warm-up, never at its cap, and its window gone.
    expect(streamWarmLines(userData).some((l) => l.includes('closed at its cap'))).toBe(false);
    expect(await warmWindows(app)).toBe(0);
  } finally {
    await app.close();
  }
});

test('without a graphics chip there is nothing to make: the stream’s warm-up page never opens', async () => {
  test.setTimeout(90_000);
  const { app, userData } = await launchApp({ ...ASK, ...WITHOUT_A_CHIP });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect
      .poll(() => streamWarmLines(userData), { timeout: 30_000 })
      .toContain('Stream warm-up: not at this start (Chromium draws without a graphics chip)');
    expect(streamWarmLines(userData).some((l) => l.includes('alone, off screen'))).toBe(false);
    expect(await warmWindows(app)).toBe(0);
  } finally {
    await app.close();
  }
});

test('a test that does not ask for it never has it', async () => {
  test.setTimeout(60_000);
  const { app, userData } = await launchApp(WITH_A_CHIP);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect
      .poll(() => streamWarmLines(userData), { timeout: 30_000 })
      .toContain('Stream warm-up: not at this start (in a test that does not ask for it)');
    expect(await warmWindows(app)).toBe(0);
  } finally {
    await app.close();
  }
});
