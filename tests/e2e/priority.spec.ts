import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { constants, getPriority } from 'node:os';
import { join } from 'node:path';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * The main process's priority on Windows (Session 16). Drashti runs ahead of
 * other programs (above normal, from Session 15); an admin can set it back to
 * normal on a computer where that suits the screens better, with File > Run
 * Ahead of Other Programs, at once and for every start after; and the
 * performance check sets it for one run with DRASHTI_PRIORITY.
 */

test.skip(process.platform !== 'win32', 'Windows only: there a program may raise its own priority');

const { PRIORITY_ABOVE_NORMAL, PRIORITY_NORMAL } = constants.priority;
const mainPid = (app: Awaited<ReturnType<typeof launchApp>>['app']) => app.process().pid ?? 0;

test('Drashti runs ahead of other programs, and an admin sets it back to normal for good', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(getPriority(mainPid(app))).toBe(PRIORITY_ABOVE_NORMAL);

  // Unticked: normal at once, kept in the data folder, and said in the window.
  await chooseMenuItem(app, 'run-ahead');
  await expect.poll(() => getPriority(mainPid(app))).toBe(PRIORITY_NORMAL);
  expect(JSON.parse(readFileSync(join(userData, 'drashti-priority.json'), 'utf8'))).toEqual({
    priority: 'normal',
  });
  await expect(win.getByText('Drashti now runs at normal priority')).toBeVisible();
  expect(
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('run-ahead')?.checked),
  ).toBe(false);
  await app.close();

  // The next start keeps it; ticked again, it runs ahead again.
  const again = await relaunchApp(userData);
  await operatorReady(await operatorPage(again.app));
  expect(getPriority(mainPid(again.app))).toBe(PRIORITY_NORMAL);
  await chooseMenuItem(again.app, 'run-ahead');
  await expect.poll(() => getPriority(mainPid(again.app))).toBe(PRIORITY_ABOVE_NORMAL);
  await again.app.close();

  // For one run (the performance check comparing the two), the environment says.
  const once = await relaunchApp(userData, { DRASHTI_PRIORITY: 'normal' });
  await operatorReady(await operatorPage(once.app));
  expect(getPriority(mainPid(once.app))).toBe(PRIORITY_NORMAL);
  await once.app.close();
});
