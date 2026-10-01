import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, outputPages, setUpScreen } from './helpers';

/*
 * Timers: the engine sends only start, pause and reset; every window works
 * out the time from the shared clock, so two outputs show the same time
 * without a message every second.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

/** Wait until the timer is half-way through a second, so no window is about to turn over. */
async function midSecond(startedAt: number): Promise<void> {
  const phase = (Date.now() - startedAt) % 1000;
  await new Promise((resolve) => setTimeout(resolve, (1500 - phase) % 1000));
}

test('a countdown on the audience screens stays in step on two windows, with no message a second', async () => {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  const win = await operatorPage(app);
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];

  // Make a countdown in the operator window, start it, and show it on the screens.
  const timers = win.getByTestId('timers');
  await timers.getByRole('button', { name: 'New timer' }).click();
  const form = timers.getByTestId('timer-form');
  await form.getByRole('textbox', { name: 'Timer name' }).fill('Placeholder sabha starts in');
  await form.getByRole('textbox', { name: 'Length' }).fill('5:00');
  await form.getByRole('button', { name: 'Save' }).click();
  const row = timers.getByTestId('timer-row');
  await expect(row.getByTestId('timer-value')).toHaveText('5:00');
  await row.getByRole('button', { name: 'Start' }).click();
  await row.getByRole('button', { name: 'Show on the screens' }).click();
  const timerOn = (p: Page) => p.locator('[data-layer="messages"]');
  for (const p of [a, b]) await expect(timerOn(p)).toContainText('Placeholder sabha starts in 4:');

  const state = (await snapshot(win)).state;
  const startedAt = state.timers[0]?.startedAt ?? 0;
  expect(startedAt).toBeGreaterThan(0);
  const rev = (await snapshot(win)).rev;

  // Sampled together, half-way through a second: the same time on both, counting down.
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await midSecond(startedAt);
    const [ta, tb] = await Promise.all([timerOn(a).innerText(), timerOn(b).innerText()]);
    expect(ta).toBe(tb);
    seen.push(ta);
  }
  expect(new Set(seen).size).toBe(3);
  // Nothing was sent while it counted.
  expect((await snapshot(win)).rev).toBe(rev);

  // Pause: both stop at the same time and stay there.
  await row.getByRole('button', { name: 'Pause' }).click();
  await expect(row).not.toHaveAttribute('data-running', 'true');
  const paused = await timerOn(a).innerText();
  await win.waitForTimeout(1500);
  expect([await timerOn(a).innerText(), await timerOn(b).innerText()]).toEqual([paused, paused]);
  // Reset: back to 5:00 everywhere.
  await row.getByRole('button', { name: 'Reset' }).click();
  for (const p of [a, b]) await expect(timerOn(p)).toHaveText('Placeholder sabha starts in 5:00');

  // Taken off the screens.
  await row.getByRole('button', { name: 'Take off the screens' }).click();
  for (const p of [a, b]) await expect(timerOn(p)).toHaveCount(0);

  await app.close();
});
