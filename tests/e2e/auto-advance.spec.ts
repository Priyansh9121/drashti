import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  killApp,
  launchApp,
  operatorPage,
  outputPage,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * Auto-advance (Session 7): slides move on by themselves in play order,
 * the presentation loops from its last slide to its first, Next starts the
 * new slide's own count, the live preview and Simple Mode show the time
 * left, and after a forced stop the slide carries on with the time it had
 * left. Placeholder words only.
 */

const snapshot = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** A presentation of three slides, each moving on after `ms`, looping or not. */
async function timedKirtan(win: Page, name: string, times: number[], loop: boolean): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'drashti-auto-')), `${name}.txt`);
  writeFileSync(file, '[Verse]\nPlaceholder one\n\nPlaceholder two\n\nPlaceholder three\n');
  const [id = ''] = await importAndGetIds(win, [file]);
  await win.evaluate(
    async ({ id, times, loop }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      const doc = opened.doc;
      doc.loop = loop;
      doc.groups[0]?.slides.forEach((s, i) => {
        s.autoAdvanceMs = times[i] ?? null;
      });
      const saved = await d.library.saveSlides(id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { id, times, loop },
  );
  return id;
}

test('slides move on by themselves, loop at the end, and Next starts the new slide’s own count', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await timedKirtan(win, 'Placeholder Timed', [1500, 1500, 1500], true);
  await setUpScreen(win);
  const output = await outputPage(app);
  const words = output.locator('[data-layer="slide"]');
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Timed/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await expect(words).toHaveText('Placeholder one');
  // The live preview says how long is left.
  const left = win.getByTestId('auto-advance');
  await expect(left).toBeVisible();
  await expect(left).toHaveAttribute('aria-label', /Moves on by itself in [12] seconds?/u);
  await expect(words).toHaveText('Placeholder two', { timeout: 5000 });

  // Next part way through: the third slide gets its own full count, from when it went up.
  await win.keyboard.press('ArrowRight');
  await expect(words).toHaveText('Placeholder three');
  const third = await snapshot(win);
  expect(third.autoAdvance?.durationMs).toBe(1500);
  expect(third.autoAdvance?.startedAt).toBe(third.layers.slide?.shownAt);
  // At the end it goes back to the first (the presentation loops).
  await expect(words).toHaveText('Placeholder one', { timeout: 5000 });

  // Black-out does not stop it.
  await win.keyboard.press('b');
  await expect
    .poll(async () => (await snapshot(win)).layers.slide?.slide.elements[0])
    .toMatchObject({
      text: 'Placeholder two',
    });
  await win.keyboard.press('b');
  // Clearing the slide stops it.
  await win.keyboard.press('F2');
  await expect(words).toHaveCount(0);
  expect((await snapshot(win)).autoAdvance).toBeNull();
  await expect(left).toHaveCount(0);

  // Simple Mode shows the time left too.
  await win.getByTestId('slide-thumb').first().click();
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('auto-advance')).toBeVisible();
  await app.close();
});

test('at the end it stops (when the presentation does not loop), and after a forced stop it carries on with its time left', async () => {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const id = await timedKirtan(win, 'Placeholder Long', [12_000, 1000, 1000], false);
  await win.evaluate(
    (pid) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: pid,
        slideIndex: 2,
      }),
    id,
  );
  // The last slide of a presentation that does not loop: nowhere to go, so no count.
  expect((await snapshot(win)).autoAdvance).toBeNull();
  await win.evaluate(
    (pid) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: pid,
        slideIndex: 0,
      }),
    id,
  );
  const started = (await snapshot(win)).autoAdvance?.startedAt ?? 0;
  // Saved again every second while it counts: wait until the file says under nine and a half seconds are left.
  const stateFile = join(first.userData, 'live-state.json');
  await expect
    .poll(
      () => {
        if (!existsSync(stateFile)) return Infinity;
        const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as {
          autoAdvance?: { leftMs: number } | null;
        };
        return saved.autoAdvance?.leftMs ?? Infinity;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(9500);
  await killApp(first.app);
  const stoppedAt = Date.now();
  const elapsedBefore = stoppedAt - started;

  const second = await relaunchApp(first.userData);
  const win2 = await operatorPage(second.app);
  await expect(win2.getByTestId('recovery-notice')).toBeVisible();
  const back = await snapshot(win2);
  expect(back.layers.slide?.slide.elements[0]).toMatchObject({ text: 'Placeholder one' });
  // It carries on with the time it had left at the stop (saved within a second), not from the start.
  const left = (back.autoAdvance?.startedAt ?? 0) + (back.autoAdvance?.durationMs ?? 0) - Date.now();
  expect(back.autoAdvance?.durationMs).toBe(12_000);
  expect(left).toBeLessThanOrEqual(12_000 - elapsedBefore + 1500);
  expect(left).toBeGreaterThan(0);
  await expect
    .poll(async () => (await snapshot(win2)).layers.slide?.slide.elements[0], { timeout: 20_000 })
    .toMatchObject({ text: 'Placeholder two' });
  await second.app.close();
});
