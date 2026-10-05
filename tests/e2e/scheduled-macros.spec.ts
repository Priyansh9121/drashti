import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, launchApp, operatorPage, operatorReady } from './helpers';

/*
 * Macros that run by themselves (Session 14), on the schedules' test clock:
 * at their time a ten-second countdown with Cancel, then the macro runs, in
 * Pro Mode and in Simple Mode (the one exception to Simple Mode running no
 * macros); Cancel stops it; a time missed by more than a minute is never
 * run late. Placeholder words only.
 */

/** The next 18:30 on this computer's clock after `after`. */
function next1830(after: number): number {
  const d = new Date(after);
  d.setHours(18, 30, 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function moveClock(app: ElectronApplication, wallMs: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    (globalThis as { drashtiArtiClock?: (wallMs: number) => void }).drashtiArtiClock?.(ms);
  }, wallMs);
}

const stageMessage = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.stageMessage);

test('a macro runs at its time after a countdown, in Simple Mode too; Cancel stops it; never late', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ DRASHTI_TEST_ARTI_CLOCK: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const made = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.macros.save(null, {
      name: 'Placeholder before sabha',
      color: '#2f9e44',
      actions: [{ kind: 'stageMessage', text: 'Placeholder: sabha soon' }],
      schedules: [{ id: 'every-day', days: [0, 1, 2, 3, 4, 5, 6], date: null, time: '18:30', enabled: true }],
    }),
  );
  expect(made.ok).toBe(true);
  // The editor shows its time, and the panel says it runs by itself.
  await expect(win.getByTestId('macros-panel').getByTestId('macro-button')).toContainText('18:30');
  await win.getByTestId('macros-panel').getByRole('button', { name: 'Edit' }).click();
  const editor = win.getByTestId('macro-editor');
  await expect(editor.getByTestId('macro-time')).toHaveCount(1);
  await expect(editor.getByTestId('macro-time-at')).toHaveValue('18:30');
  await expectNoSeriousA11yIssues(win, 'the macro editor with a time');
  await editor.getByRole('button', { name: 'Close macros' }).click();

  // At its time: ten seconds counted down, then it runs.
  let at = next1830(Date.now());
  await moveClock(app, at + 500);
  const countdown = win.getByTestId('macro-countdown');
  await expect(countdown).toContainText('Placeholder before sabha');
  await expect(countdown).toContainText('runs by itself in ten seconds');
  await expectNoSeriousA11yIssues(win, 'a macro counting down');
  expect(await stageMessage(win)).toBeNull();
  await moveClock(app, at + 11_000);
  await expect.poll(() => stageMessage(win)).toBe('Placeholder: sabha soon');
  await expect(countdown).toHaveCount(0);

  // The next day: Cancel, and it does not run.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearStageMessage' }),
  );
  at = next1830(at + 1000);
  await moveClock(app, at + 500);
  await expect(countdown).toBeVisible();
  await countdown.getByTestId('macro-countdown-cancel').click();
  await expect(countdown).toHaveCount(0);
  await moveClock(app, at + 15_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(await stageMessage(win)).toBeNull();

  // In Simple Mode too (a big strip a volunteer can cancel), where no button runs a macro.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const refused = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.macros.run(id),
    made.ok ? made.id : '',
  );
  expect(refused.ok).toBe(false);
  at = next1830(at + 1000);
  await moveClock(app, at + 500);
  await expect(countdown).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'a macro counting down in Simple Mode');
  await moveClock(app, at + 11_000);
  await expect.poll(() => stageMessage(win)).toBe('Placeholder: sabha soon');

  // A time the computer slept through by more than a minute is not run late.
  await chooseMenuItem(app, 'switch-mode');
  await win.getByTestId('leave-simple').getByRole('textbox').fill('pro');
  await win.getByTestId('leave-simple-switch').click();
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearStageMessage' }),
  );
  at = next1830(at + 1000);
  await moveClock(app, at + 2 * 60_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await expect(countdown).toHaveCount(0);
  expect(await stageMessage(win)).toBeNull();
  await app.close();
});
