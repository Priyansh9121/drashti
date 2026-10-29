import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  holdStill,
  launchApp,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Access by mode (Session 55, Part 19, the owner's decisions of 29 Oct 2026), against the stand-in list on 127.0.0.1:
 * a Gmail given Simple access may use Simple Mode only. Its Drashti opens in Simple Mode and has no way to Pro Mode: no
 * Switch to Pro Mode… in the window or the View menu, and the main process refuses Pro Mode and everything Simple Mode
 * refuses, whatever a page sends. The owner changing it to Pro, Pro Mode comes back by itself within a check (15 s);
 * changed back to Simple, Drashti drops to Simple Mode at that answer. Placeholder Gmails only.
 */

const SIMPLE_PERSON = 'simple.placeholder@example.com';

const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** Whether the View menu offers a way to switch the mode now. */
const switchOffered = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Boolean(Menu.getApplicationMenu()?.getMenuItemById('switch-mode')));

/** What a page's requests get now, each by the main process: leaving Simple Mode, a change, and Simple Mode's lock. */
const tryAll = (win: Page) =>
  win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const said = async (run: () => Promise<unknown>) => {
      try {
        return JSON.stringify(await run());
      } catch (error) {
        return String(error);
      }
    };
    return {
      // The word typed, as the old way out took it.
      pro: await said(() => d.app.setMode('pro', 'pro')),
      // A change Simple Mode refuses (a playlist made), and an engine command it refuses (the Look switched).
      playlist: await said(() => d.playlists.create('Placeholder playlist', null, false)),
      look: await said(() => d.engine.dispatch({ type: 'setLook', lookId: 'placeholder-look' })),
    };
  });

test('Simple access: Simple Mode only, with no way to Pro Mode in the window, the View menu or the main process; the owner giving Pro, Pro Mode comes back by itself, and Simple again drops it to Simple Mode', async () => {
  test.setTimeout(150_000);
  const { app, access: s } = await launchApp({}, undefined, {
    as: { gmail: SIMPLE_PERSON },
    mode: 'simple',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const simple = win.getByTestId('simple-mode');
    // Opened in Simple Mode, whatever it was in before (a clean start is Pro Mode's).
    await expect(simple).toBeVisible();
    expect(await modeOf(win)).toBe('simple');
    // No way to Pro Mode: not on Simple Mode's screen, not in the View menu.
    await expect(win.getByTestId('simple-leave')).toHaveCount(0);
    expect(await switchOffered(app)).toBe(false);
    await chooseMenuItem(app, 'switch-mode');
    await expect(win.getByTestId('leave-simple')).toHaveCount(0);
    // Said plainly, where the way out was.
    await expect(win.getByTestId('simple-access')).toContainText('Simple Mode only');
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await expectFits(win.getByTestId('simple-mode'), 'Simple Mode with Simple access at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'Simple Mode with Simple access at 1024 × 645');
    // The main process refuses Pro Mode, and all Simple Mode refuses, whatever a page sends.
    const tried = await tryAll(win);
    expect(tried.pro).toContain('"ok":false');
    expect(tried.pro).toContain('Simple Mode only');
    expect(tried.playlist).toContain('Simple Mode is on');
    expect(tried.look).toContain('Simple Mode is on');
    expect(await modeOf(win)).toBe('simple');
    await holdStill(
      async () => (await modeOf(win)) === 'simple',
      3000,
      'nothing a page sent took it out of Simple Mode',
    );

    // The owner gives this Gmail Pro: at its next check (every 15 s), Pro Mode comes back by itself.
    s.setMode(SIMPLE_PERSON, 'pro');
    await expect(simple).toHaveCount(0, { timeout: 25_000 });
    expect(await modeOf(win)).toBe('pro');
    await expect(win.getByTestId('app-header')).toBeVisible();
    expect(await switchOffered(app)).toBe(true);

    // And Simple again: dropped to Simple Mode at that answer, with no way back.
    s.setMode(SIMPLE_PERSON, 'simple');
    await expect(simple).toBeVisible({ timeout: 25_000 });
    expect(await modeOf(win)).toBe('simple');
    await expect(win.getByTestId('simple-leave')).toHaveCount(0);
    expect(
      JSON.stringify(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'))),
    ).toContain('"ok":false');
  } finally {
    await app.close();
  }
});

test('Pro access: Simple Mode the operator chose stays when the owner gives Simple and then Pro again; and Pro Mode’s Switch to Pro Mode… is back with Pro access', async () => {
  test.setTimeout(150_000);
  const { app, access: s } = await launchApp({}, undefined, { as: { gmail: SIMPLE_PERSON } });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    expect(await modeOf(win)).toBe('pro');
    // The operator's own choice: Simple Mode.
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
    const simple = win.getByTestId('simple-mode');
    await expect(simple).toBeVisible();
    await expect(win.getByTestId('simple-leave')).toBeVisible();
    // Simple access: the way out goes at the next check.
    s.setMode(SIMPLE_PERSON, 'simple');
    await expect(win.getByTestId('simple-leave')).toHaveCount(0, { timeout: 25_000 });
    // Pro again: the way out is back, and Simple Mode stays, the operator's own choice.
    s.setMode(SIMPLE_PERSON, 'pro');
    await expect(win.getByTestId('simple-leave')).toBeVisible({ timeout: 25_000 });
    await holdStill(
      async () => (await modeOf(win)) === 'simple',
      3000,
      'Simple Mode chosen by the operator stays',
    );
  } finally {
    await app.close();
  }
});
