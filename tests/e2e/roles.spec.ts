import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_REFUSAL } from '../../src/shared/roles';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { chooseMenuItem, killApp, launchApp, operatorPage, operatorReady, relaunchApp } from './helpers';

/*
 * Roles (Session 14): an admin PIN and an operator PIN. Off until set; with
 * them, leaving Simple Mode takes a PIN, the main process refuses every
 * admin request from an operator, the admin PIN unlocks admin for a while,
 * and wrong PINs are limited (over a restart too). Made-up PINs only, never
 * printed.
 */

const ADMIN = '481526';
const OPERATOR = '937402';

const mode = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());
const roles = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.roles.view());
const groupNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.screens.get()).groups.map((g) => g.name),
  );

async function setPins(win: Page): Promise<void> {
  const r = await win.evaluate((pins) => (globalThis as PageGlobals).drashti.roles.setPins(pins), {
    admin: ADMIN,
    operator: OPERATOR,
  });
  expect(r.ok).toBe(true);
}

test('roles are off by default: Pro Mode changes anything without a PIN, and Simple Mode is left with the word', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(await roles(win)).toEqual({ on: false, adminUntil: null, waitUntil: null });
  await expect(win.getByTestId('role-chip')).toHaveCount(0);
  const made = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder A'),
  );
  expect(made.ok).toBe(true);
  await expect(win.getByTestId('admin-pin')).toHaveCount(0);
  // Simple Mode and back, with the word, as before roles.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await chooseMenuItem(app, 'switch-mode');
  const leave = win.getByTestId('leave-simple');
  await expect(leave).toContainText('Type pro to switch');
  await leave.getByRole('textbox').fill('pro');
  await leave.getByTestId('leave-simple-switch').click();
  await expect.poll(() => mode(win)).toBe('pro');
  expect(existsSync(join(userData, 'roles.json'))).toBe(false);
  await app.close();
});

test('two PINs turn roles on; an operator is refused every admin request in the main process; the admin PIN unlocks it', async () => {
  test.setTimeout(120_000);
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);

  // File > Roles and PINs…: two PINs, typed twice.
  await chooseMenuItem(app, 'roles-and-pins');
  const dialog = win.getByTestId('roles-dialog');
  await expect(dialog).toContainText('Roles are off');
  await expectNoSeriousA11yIssues(win, 'Roles and PINs, off');
  await dialog.getByTestId('roles-admin-pin').fill(ADMIN);
  await dialog.getByTestId('roles-admin-again').fill(ADMIN);
  await dialog.getByTestId('roles-operator-pin').fill(ADMIN);
  await dialog.getByTestId('roles-operator-again').fill(ADMIN);
  await expect(dialog).toContainText('must differ');
  await expect(dialog.getByTestId('roles-turn-on')).toBeDisabled();
  await dialog.getByTestId('roles-operator-pin').fill(OPERATOR);
  await dialog.getByTestId('roles-operator-again').fill(OPERATOR);
  await dialog.getByTestId('roles-turn-on').click();
  await expect(dialog).toHaveCount(0);
  // Whoever set them is the admin, unlocked for a while.
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'admin');
  expect((await roles(win)).on).toBe(true);
  // Only hashes are kept, never the PINs.
  const file = readFileSync(join(userData, 'roles.json'), 'utf8');
  expect(file).not.toContain(ADMIN);
  expect(file).not.toContain(OPERATOR);
  await chooseMenuItem(app, 'roles-and-pins');
  await expect(dialog).toContainText('Two PINs are set');
  await expectNoSeriousA11yIssues(win, 'Roles and PINs, on');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // Lock: an operator now.
  await win.getByTestId('role-chip').click();
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'operator');
  const before = await groupNames(win);

  // An admin request asks for the admin PIN first; cancelled, the main process refuses it.
  const cancelled = win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder B'),
  );
  const prompt = win.getByTestId('admin-pin');
  await expect(prompt).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the admin PIN prompt');
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  expect(await cancelled).toEqual({ ok: false, message: ADMIN_REFUSAL });
  expect(await groupNames(win)).toEqual(before);

  // Every admin request is refused in the main process (the page's prompt answering "no" at once).
  await win.evaluate(() => {
    (globalThis as PageGlobals).drashti.roles.setAdminAsker(() => Promise.resolve(false));
  });
  const answers = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      createGroup: await d.screens.createGroup('Placeholder C'),
      look: await d.looks.create('Placeholder Look', null),
      theme: await d.themes.save(null, {
        name: 'Placeholder theme',
        styles: {},
        box: null,
        background: { kind: 'none' },
      } as never),
      networkOn: await d.network.setOn(true),
      pairNode: await d.nodes.startPairing(),
      macro: await d.macros.save(null, { name: 'Placeholder macro', color: '#3e63dd', actions: [] }),
      arti: await d.arti.remove('no-such-schedule'),
      remove: await d.library.removePresentations(['no-such-presentation']),
      pick: await d.library.pickImportPaths('files'),
      pins: await d.roles.turnOff(),
      streamKey: await d.stream.setKey('no-such-profile', 'placeholder'),
      calendar: await d.calendar.remove('no-such-calendar'),
      logo: await d.props.setLogo(null),
    };
  });
  for (const [what, answer] of Object.entries(answers)) {
    if (what === 'pick') expect(answer, what).toEqual([]);
    else expect(answer, what).toMatchObject({ ok: false, message: ADMIN_REFUSAL });
  }
  expect(await groupNames(win)).toEqual(before);
  expect((await roles(win)).on).toBe(true);
  // What an operator does is not refused: running the show, playlists.
  const playlist = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.playlists.create('Placeholder operator playlist', null, false),
  );
  expect(playlist.ok).toBe(true);

  // Back to the window's own prompt (a reload connects it again): the operator PIN does not unlock
  // admin, a wrong one is said, and the admin PIN does, and the request goes through.
  await win.reload();
  await operatorReady(win);
  const allowed = win.evaluate(() =>
    (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder D'),
  );
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('admin-pin-input').fill(OPERATOR);
  await prompt.getByTestId('admin-pin-unlock').click();
  await expect(prompt).toContainText('That is the operator PIN');
  await prompt.getByTestId('admin-pin-input').fill('000000');
  await prompt.getByTestId('admin-pin-unlock').click();
  await expect(prompt).toContainText('That PIN is not right');
  await prompt.getByTestId('admin-pin-input').fill(ADMIN);
  await prompt.getByTestId('admin-pin-unlock').click();
  await expect(prompt).toHaveCount(0);
  expect((await allowed).ok).toBe(true);
  expect(await groupNames(win)).toContain('Placeholder D');
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'admin');
  // A menu item that needs admin, with admin unlocked, goes straight ahead.
  await chooseMenuItem(app, 'set-up-screens');
  await expect(win.getByTestId('setup-wizard')).toBeVisible();
  await win.getByRole('button', { name: 'Close the setup' }).click();
  // Locked again, a menu item asks for the PIN, and does nothing when cancelled.
  await win.getByTestId('role-chip').click();
  await chooseMenuItem(app, 'set-up-screens');
  await expect(prompt).toContainText('To set up the screens');
  await prompt.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.getByTestId('setup-wizard')).toHaveCount(0);
  await app.close();
});

test('leaving Simple Mode takes a PIN: the operator PIN for Pro Mode, the admin PIN for admin too', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await setPins(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect.poll(() => mode(win)).toBe('simple');
  // Entering Simple Mode locks admin at once.
  expect((await roles(win)).adminUntil).toBeNull();
  await chooseMenuItem(app, 'switch-mode');
  const leave = win.getByTestId('leave-simple');
  await expect(leave).toContainText('operator PIN or the admin PIN');
  await expectNoSeriousA11yIssues(win, 'leaving Simple Mode with a PIN');
  // The word no longer works.
  await leave.getByTestId('leave-simple-pin').fill('123');
  await expect(leave.getByTestId('leave-simple-pin')).toHaveValue('123');
  await leave.getByTestId('leave-simple-pin').fill(OPERATOR);
  await leave.getByTestId('leave-simple-switch').click();
  await expect.poll(() => mode(win)).toBe('pro');
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'operator');
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await chooseMenuItem(app, 'switch-mode');
  await leave.getByTestId('leave-simple-pin').fill(ADMIN);
  await leave.getByTestId('leave-simple-switch').click();
  await expect.poll(() => mode(win)).toBe('pro');
  await expect(win.getByTestId('role-chip')).toHaveAttribute('data-role', 'admin');
  await app.close();
});

test('wrong PINs are limited, over a restart too; with roles on a clean start opens in Simple Mode, a crash during a show comes back as it was', async () => {
  test.setTimeout(120_000);
  const first = await launchApp();
  let win = await operatorPage(first.app);
  await operatorReady(win);
  await setPins(win);
  // A crash in Pro Mode during a show comes back in Pro Mode (the operator carries on), admin locked.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [first] = await d.library.listPresentations();
    await d.engine.dispatch({ type: 'goLive', presentationId: first?.id ?? '', slideIndex: 0 });
  });
  const liveFile = join(first.userData, 'live-state.json');
  await expect
    .poll(() => (existsSync(liveFile) ? readFileSync(liveFile, 'utf8') : ''))
    .toContain('"slideIndex":0');
  await killApp(first.app);
  let run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await mode(win)).toBe('pro');
  expect((await roles(win)).adminUntil).toBeNull();
  await run.app.close();
  // A clean start opens in Simple Mode.
  run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await mode(win)).toBe('simple');
  // Five wrong PINs, then a wait, even for the right one.
  await chooseMenuItem(run.app, 'switch-mode');
  const leave = win.getByTestId('leave-simple');
  for (let i = 0; i < 4; i++) {
    await leave.getByTestId('leave-simple-pin').fill('000000');
    await leave.getByTestId('leave-simple-switch').click();
    await expect(leave).toContainText('That PIN is not right');
  }
  await leave.getByTestId('leave-simple-pin').fill('000000');
  await leave.getByTestId('leave-simple-switch').click();
  await expect(leave).toContainText('Too many wrong PINs');
  await leave.getByTestId('leave-simple-pin').fill(OPERATOR);
  await expect(leave.getByTestId('leave-simple-switch')).toBeDisabled();
  const refused = await win.evaluate(
    (pin) => (globalThis as PageGlobals).drashti.app.setMode('pro', pin),
    OPERATOR,
  );
  expect(refused.ok ? '' : refused.message).toContain('Too many wrong PINs');
  await run.app.close();
  // Still waiting after a restart.
  run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  const still = await win.evaluate(
    (pin) => (globalThis as PageGlobals).drashti.app.setMode('pro', pin),
    OPERATOR,
  );
  expect(still.ok ? '' : still.message).toContain('Try again in');
  expect(await mode(win)).toBe('simple');
  await run.app.close();
});

test('the setup wizard offers to set the PINs', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  await chooseMenuItem(app, 'set-up-screens');
  const wizard = win.getByTestId('setup-wizard');
  await wizard.getByTestId('setup-next').click();
  for (const step of ['Screens', 'Sound', 'Stream', 'Theme']) {
    await expect(wizard.getByTestId('setup-step')).toHaveText(step);
    await wizard.getByTestId('setup-skip').click();
  }
  await expect(wizard.getByTestId('setup-step')).toHaveText('PINs');
  await wizard.getByTestId('setup-pins-on').check();
  await wizard.getByTestId('setup-admin-pin').fill(ADMIN);
  await wizard.getByLabel('Again').first().fill(ADMIN);
  await wizard.getByTestId('setup-operator-pin').fill(OPERATOR);
  await wizard.getByLabel('Again').nth(1).fill(OPERATOR);
  await expectNoSeriousA11yIssues(win, 'the setup wizard, PINs');
  await wizard.getByTestId('setup-next').click();
  await expect(wizard.getByTestId('setup-summary')).toContainText('PINs: two PINs set');
  await wizard.getByTestId('setup-finish').click();
  await expect(wizard.getByTestId('setup-done')).toBeVisible();
  await expect.poll(async () => (await roles(win)).on).toBe(true);
  await app.close();
});
