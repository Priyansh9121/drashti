import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, operatorPage, operatorReady, setUpScreen, windowShowing } from './helpers';
import { logLines } from './log-lines';

/*
 * The stream's page's own warm-up as it opens (Session 60, X21; C19's finding; the owner's answer A to Q60-1). Opened
 * mid-show it warmed the graphics chip up as every page does, and that drawing held the hall's frames (CI's Mac: its
 * 5.5-7.8 s of drawing, the hall's longest frame 1-3 s), while what it would make was already made by the hall's
 * screens' own warm-ups. Once a hall screen on this computer has drawn its warm-up whole at this start (the opening
 * over, or not playing), the stream's page draws the show at once, with no warm-up of its own; before then it warms
 * itself up as before (stream/stream-warm.ts). How Main reads Chromium's gpu_compositing is set by a test switch
 * (warm-up.spec.ts); a computer without a graphics chip is warm-up.spec.ts's (WU-1).
 */

const WITH_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'enabled' };
/** The log's line for the stream's page drawing the show without a warm-up of its own. */
const NONE = 'Warm-up: none of its own, the hall’s screens drew theirs at this start, for the stream’s page';

/** Drashti's log lines so far, each from its "Warm-up" on. */
function warmUpLog(userData: string): string[] {
  if (!existsSync(join(userData, 'logs'))) return [];
  return logLines(userData)
    .filter((line) => / Warm-up(?::| of )/u.test(line))
    .map((line) => line.slice(line.indexOf('Warm-up')).trimEnd());
}

/** How each hall screen's warm-up ended, as the log says it once a screen (Session 58, WU-2), in order. */
const hallEnds = (userData: string) =>
  warmUpLog(userData).filter((line) => line.startsWith('Warm-up of output '));
/** A hall screen's warm-up that drew everything: the only end the rule counts. */
const DREW_WHOLE = ': drew everything in ';

/** The log's lines for the stream's page. */
const streamLines = (userData: string) =>
  warmUpLog(userData).filter((line) => line.endsWith('for the stream’s page'));

/** The page's warm-up marks for a trace (render/WarmUp.tsx). */
const warmUpMarks = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .map((m) => m.name)
      .filter((name) => name.startsWith('drashti-warm-up')),
  );

const streamPage = (app: ElectronApplication) =>
  windowShowing(app, (p) => p.url().includes('stream.html'), 'stream');

test('with a graphics chip, the stream’s page opened after a hall screen drew its warm-up whole draws the show at once, with no warm-up of its own, and the log says so once', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp({
    ...WITH_A_CHIP,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win, 'Main Hall', 0);
    await expect.poll(() => hallEnds(userData).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    // A second hall screen once the first one's warm-up has ended. At a new CI Mac's first start the first one makes
    // every drawing pipeline as it warms up and can end at its longest (17.2 s: x21-1119-144119-60099); the second
    // draws with what the first made, and draws everything there (the measuring's second screen: 2.0-3.6 s).
    await setUpScreen(win, 'Side Hall', 1);
    await expect.poll(() => hallEnds(userData).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    // CI's Mac has a graphics chip of its own: a hall screen there draws everything, so the rule's main way is tested
    // there. A computer pretending to have one (CI's Windows draws in software) may end its warm-ups otherwise.
    const drewWhole = hallEnds(userData).some((line) => line.includes(DREW_WHOLE));
    if (process.platform === 'darwin') expect(drewWhole, hallEnds(userData).join('\n')).toBe(true);
    await win.getByTestId('open-stream').click();
    const program = await streamPage(app);
    const root = program.getByTestId('program-root');
    await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 60_000 });
    const marks = await warmUpMarks(program);
    if (drewWhole) {
      // None of its own: no warm-up drawn, no mark of one, and the log says why, once.
      await expect(root).toHaveAttribute('data-warm-up', 'not-needed');
      expect(marks, 'the stream’s page’s warm-up marks').toEqual([]);
      await expect.poll(() => streamLines(userData).filter((line) => line === NONE)).toEqual([NONE]);
    } else {
      // No hall screen drew everything (a computer pretending to have a chip): the stream's page warmed itself up, as
      // before.
      await expect(root).toHaveAttribute('data-warm-up', 'done');
      expect(marks, 'the stream’s page’s warm-up marks').toContain('drashti-warm-up:stream');
      expect(streamLines(userData)).not.toContain(NONE);
    }
  } finally {
    await app.close();
  }
});

test('with no hall screen warmed up at this start, the stream’s page warms itself up as before', async () => {
  test.setTimeout(150_000);
  const { app, userData } = await launchApp(WITH_A_CHIP);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // The LIVE picture's warm-up over (the operator window's: not a hall screen).
    await expect(win.locator('[data-testid="live-preview"] [data-warm-up]')).toHaveCount(0, {
      timeout: 60_000,
    });
    await win.getByTestId('open-stream').click();
    const program = await streamPage(app);
    const root = program.getByTestId('program-root');
    await expect(root).toHaveAttribute('data-fonts', 'ready', { timeout: 60_000 });
    await expect(root).toHaveAttribute('data-warm-up', 'done');
    expect(await warmUpMarks(program), 'the stream’s page’s warm-up marks').toContain(
      'drashti-warm-up:stream',
    );
    expect(streamLines(userData)).not.toContain(NONE);
  } finally {
    await app.close();
  }
});
