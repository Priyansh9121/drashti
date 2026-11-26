import { expect, test } from '@playwright/test';
import { launchApp, operatorPage, operatorReady } from './helpers';
import { logText } from './log-lines';

/*
 * The HEVC question's own page (hevc-page.ts) answers however the main process tidies its memory (alpha.21's first
 * item: on the owner's Mac, 2 of alpha.20's 5 starts never heard Chromium's answer at all, and CI's start-marks.spec:48
 * waited 60 s for it late in a run). The page lives in a view no window holds: once nothing in Drashti holds it either,
 * a garbage collection may take it, and its question with it. No content: a blank page.
 */

/** The HEVC question's answer, as the log says it. */
const HEVC_ANSWERED = /This computer (plays|cannot play) HEVC video/u;

test('the HEVC question’s page answers even when the main process collects its garbage while it waits (Chromium’s answer 15 s late)', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp({ DRASHTI_TEST_HEVC_ANSWER_MS: '15000' });
  try {
    const log = () => logText(userData);
    await operatorReady(await operatorPage(app));
    // The question is on its way, in its blank page.
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }) =>
            webContents.getAllWebContents().filter((c) => c.getURL() === 'about:blank').length,
        ),
      )
      .toBe(1);
    expect(log()).not.toMatch(HEVC_ANSWERED);
    // The main process tidies its memory, as it may at any moment, several times over.
    await app.evaluate(() => {
      const v8 = process.getBuiltinModule('node:v8');
      const vm = process.getBuiltinModule('node:vm');
      v8.setFlagsFromString('--expose_gc');
      const collect = vm.runInNewContext('gc') as () => void;
      for (let i = 0; i < 5; i++) collect();
    });
    // The answer still comes, and the page goes after it.
    await expect.poll(log, { timeout: 60_000 }).toMatch(HEVC_ANSWERED);
    await app.close();
  } finally {
    await app.close().catch(() => undefined);
  }
});
