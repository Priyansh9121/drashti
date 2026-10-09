import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_LINES } from '../../src/main/db/seed';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen, type PageGlobals } from './helpers';

/*
 * A render error on an output (Session 23). An element that throws as it
 * renders (a test hook: DRASHTI_TEST_RENDER_ERRORS, which a packaged Drashti
 * ignores) stands in for any bug in the scene. Before Session 23, React left
 * the output's page empty, its process looked healthy to the watchdog, and
 * nothing reached the log: the screen stayed blank for the rest of the sabha.
 */

interface WatchdogGlobals {
  drashtiDiagnostics: { watchdog: { events: { window: string; kind: string }[] } };
  drashtiTestRenderError?: (screenId?: string) => number;
}

test('a render error on an output: black (never text), logged, and the output reloads once and shows the live slide', async () => {
  test.setTimeout(90_000);
  const { app, userData } = await launchApp({ DRASHTI_TEST_RENDER_ERRORS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready');
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const list = await d.library.listPresentations();
    const id = list.find((p) => p.name === 'Language test slides')?.id ?? '';
    await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
  });
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);

  // What the page shows as the error happens, said on its console (the reload clears the page).
  const seen: string[] = [];
  out.on('console', (m) => {
    if (m.text().startsWith('render-watch:')) seen.push(m.text().slice('render-watch: '.length));
  });
  await out.evaluate(() => {
    const say = (what: string) => {
      console.log(`render-watch: ${what}`);
    };
    new MutationObserver(() => {
      const fallback = document.querySelector('[data-render-error]');
      if (!document.querySelector('[data-testid="output-root"]')) say('output-root gone');
      else if (fallback)
        say(`black fallback: ${getComputedStyle(fallback).backgroundColor}, text "${fallback.textContent}"`);
    }).observe(document.body, { subtree: true, childList: true });
  });
  const sent = await app.evaluate(
    () => (globalThis as unknown as WatchdogGlobals).drashtiTestRenderError?.() ?? 0,
  );
  expect(sent).toBe(1);

  // The screen draws black, with no words, and the output's root stays.
  await expect.poll(() => seen).toContain('black fallback: rgb(0, 0, 0), text ""');
  expect(seen).not.toContain('output-root gone');
  // The error reaches the main process's log.
  const log = () => readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8');
  await expect
    .poll(log)
    .toMatch(/Render error in output "[^"]+" \(caught\): Error: A test asked this output to fail/u);
  // The watchdog reloads that output once, and it shows the live slide again.
  const events = () =>
    app.evaluate(() =>
      (globalThis as unknown as WatchdogGlobals).drashtiDiagnostics.watchdog.events
        .filter((e) => e.window.startsWith('output '))
        .map((e) => e.kind),
    );
  await expect.poll(events).toEqual(['render-error', 'reloaded']);
  await expect(out.locator('[data-lang="en"]')).toHaveText(TEST_LINES.en);
  await expect(out.locator('[data-render-error]')).toHaveCount(0);
  await app.close();
});
