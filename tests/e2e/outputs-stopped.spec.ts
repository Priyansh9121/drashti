import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_LINES } from '../../src/main/db/seed';
import { clearOfShowControls } from './fit';
import {
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  type PageGlobals,
} from './helpers';

/*
 * An output the watchdog gave up on (Session 23): before, it stayed black for
 * the rest of the sabha, still counted as showing, with nobody told. The crash
 * loop itself is the watchdog's unit test (Playwright cannot follow a renderer
 * that crashes); here a test hook (DRASHTI_TEST_GIVE_UP, ignored by a packaged
 * Drashti) marks the output as given up on, as the crash loop would.
 */

interface Globals {
  drashtiTestGiveUp?: (screenId: string) => void;
  drashtiDiagnostics: { watchdog: { events: { window: string; kind: string; reason?: string }[] } };
}

test('an output given up on is Stopped in Screens and the status line, never a modal; Try again brings it back', async () => {
  test.setTimeout(90_000);
  const { app, userData } = await launchApp({ DRASHTI_TEST_GIVE_UP: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.library.listPresentations();
    const id = list.find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);

  await app.evaluate((_electron, id) => {
    (globalThis as unknown as Globals).drashtiTestGiveUp?.(id);
  }, screenId);
  // The status line says so, and it is no longer counted as showing.
  await expect(win.getByTestId('screens-summary')).toContainText('0 screens showing · 1 stopped');
  const status = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.screens.get()).status,
  );
  expect(status.find((s) => s.screenId === screenId)?.state).toBe('stopped');
  // Screens says what happened, with Try again; it stays Stopped while nothing loads it again.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const row = win.getByTestId('screen-row').first();
  await expect(row.getByTestId('screen-state')).toHaveText(/^Stopped/u);
  await expect(row.getByTestId('screen-stopped')).toContainText('tries it again by itself');
  await expect(win.getByTestId('screens-summary')).toContainText('1 stopped', { timeout: 5000 });
  // Its next step is the row's one primary (Session 26g).
  await expect(row.getByTestId('screen-try-again')).toHaveAttribute('data-variant', 'primary');
  await row.getByTestId('screen-try-again').click();
  await expect(row.getByTestId('screen-state')).toHaveText(/^Showing/u, { timeout: 20_000 });
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);
  const events = await app.evaluate(() =>
    (globalThis as unknown as Globals).drashtiDiagnostics.watchdog.events.map(
      (e) => `${e.kind} ${e.reason ?? ''}`,
    ),
  );
  expect(events).toContain('retried Try again');
  // Never a modal (quiet test mode answers any dialog, and says so in the log).
  expect(readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')).not.toContain(
    'Quiet test mode: answered',
  );
  await app.close();
});

test('a stopped screen raises a notice naming it, in Pro and Simple Mode, never over the show controls; Try again brings it back and the notice goes', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ DRASHTI_TEST_GIVE_UP: '1' });
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  const screenId = await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  const name = await win.evaluate(
    async (id) =>
      (await (globalThis as PageGlobals).drashti.screens.get()).groups
        .flatMap((g) => g.screens)
        .find((sc) => sc.id === id)?.name ?? '',
    screenId,
  );
  expect(name).not.toBe('');
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.library.listPresentations();
    const id = list.find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);
  const giveUp = () =>
    app.evaluate((_electron, id) => {
      (globalThis as unknown as Globals).drashtiTestGiveUp?.(id);
    }, screenId);
  const state = () =>
    win.evaluate(
      async (id) =>
        (await (globalThis as PageGlobals).drashti.screens.get()).status.find((st) => st.screenId === id)
          ?.state,
      screenId,
    );

  // Pro Mode: the notice rises, says which screen, and its one primary is Try again.
  await giveUp();
  const notice = win.getByTestId('screen-stopped-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(notice).toContainText(`“${name}” has stopped`);
  await expect(notice.locator('[data-variant="primary"]')).toHaveCount(1);
  await expect(notice.getByTestId('screen-stopped-try-again')).toHaveAttribute('data-variant', 'primary');
  await clearOfShowControls(win, notice);
  // Try again: the screen is back, showing the slide, and the notice has gone by itself.
  await notice.getByTestId('screen-stopped-try-again').click();
  await expect.poll(state, { timeout: 20_000 }).toBe('showing');
  await expect(notice).toHaveCount(0);
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);

  // Simple Mode: the same notice, clear of the big buttons; closed, it goes though the screen is still stopped.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await giveUp();
  const simple = win.getByTestId('simple-mode').getByTestId('screen-stopped-notice');
  await expect(simple).toBeVisible();
  await expect(simple).toContainText(`“${name}” has stopped`);
  await clearOfShowControls(win, simple);
  await simple.getByRole('button', { name: 'Dismiss' }).click();
  await expect(simple).toHaveCount(0);
  expect(await state()).toBe('stopped');
  // Simple Mode may try it again (it changes nothing but brings the screen back): back, and no notice.
  expect(
    await win.evaluate(
      async (id) => (await (globalThis as PageGlobals).drashti.screens.tryAgain(id)).ok,
      screenId,
    ),
  ).toBe(true);
  await expect.poll(state, { timeout: 20_000 }).toBe('showing');
  await expect(simple).toHaveCount(0);
  // Stopped again later: the notice comes again, and its Try again works in Simple Mode too.
  await giveUp();
  await expect(simple).toBeVisible();
  await simple.getByTestId('screen-stopped-try-again').click();
  await expect.poll(state, { timeout: 20_000 }).toBe('showing');
  await expect(simple).toHaveCount(0);
  await app.close();
});

test('an output given up on while Main is in the middle of a query of its own waits its turn, as the watchdog’s own word does (alpha.14’s gate on Windows, 4 Nov 2026)', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp({ DRASHTI_TEST_GIVE_UP: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const screenId = await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
  // The library's own connection, as Main's next query opens a statement on it.
  await app.evaluate((electron) => {
    // In Main: its own module loader, from the app's folder (the test's imports are not there).
    const { createRequire } = process.getBuiltinModule('node:module');
    const sqlite = createRequire(`${electron.app.getAppPath()}/package.json`)('better-sqlite3') as {
      prototype: { prepare: (this: object, ...args: unknown[]) => unknown };
    };
    const prepare = sqlite.prototype.prepare;
    sqlite.prototype.prepare = function (this: object, ...args: unknown[]) {
      (globalThis as { drashtiTestLibrary?: object }).drashtiTestLibrary ??= this;
      return prepare.apply(this, args);
    };
  });
  await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
  // Main busy for 3 s in the middle of a query of its own (as when an output's report reached it on CI's Windows):
  // the test's word that the output was given up on arrives meanwhile, between two of Main's own steps.
  await app.evaluate(() => {
    const library = (
      globalThis as {
        drashtiTestLibrary?: {
          function: (name: string, run: () => number) => void;
          prepare: (sql: string) => { get: () => unknown };
        };
      }
    ).drashtiTestLibrary;
    if (!library) throw new Error('Main opened no statement on its library');
    // Its query calls back into JavaScript (as the library does to make each row) and takes 3 s there.
    library.function('drashti_test_busy', () => {
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        // Main in the middle of its query.
      }
      return 1;
    });
    // In Main: its own query, on its next turn, not inside this call.
    setTimeout(() => {
      library.prepare('SELECT drashti_test_busy() AS n').get();
    }, 0);
  });
  await letTimePass(win, 500, 'Main is in the middle of its own query');
  await app.evaluate((_electron, id) => {
    (globalThis as unknown as Globals).drashtiTestGiveUp?.(id);
  }, screenId);
  // Stopped once Main's own query has finished: the notice rises and the screen is counted as stopped.
  await expect(win.getByTestId('screen-stopped-notice')).toBeVisible();
  await expect(win.getByTestId('screens-summary')).toContainText('0 screens showing · 1 stopped');
  await app.close();
});
