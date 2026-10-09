import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_LINES } from '../../src/main/db/seed';
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
