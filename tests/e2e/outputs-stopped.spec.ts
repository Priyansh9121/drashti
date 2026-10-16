import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_LINES } from '../../src/main/db/seed';
import { clearOfShowControls } from './fit';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen, type PageGlobals } from './helpers';

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
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
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
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
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
