import { expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { killApp, launchApp, operatorPage, outputPage, relaunchApp, savedLive, setUpScreen } from './helpers';
import { makeSlides } from './placeholder-slides';

/*
 * The recovery figure (Sessions 31–36, PERF-1): after a crash, how long from Drashti starting again to its
 * screens back, read from the start's phase lines in its own log (src/main/start-phases.ts): the output's
 * first painted frame of the show recovery put back. The phases before it say where the time went.
 */

export interface Phase {
  what: string;
  ms: number;
}

/** The last start's phase lines in a data folder's log, in order ("Start: <what> at <ms> ms"). */
export function lastStartPhases(userData: string): Phase[] {
  const file = join(userData, 'logs', 'drashti.log');
  if (!existsSync(file)) return [];
  const phases: Phase[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /Start: (.+) at (\d+) ms$/u.exec(line);
    if (!m) continue;
    // Each start begins again with the main process running.
    if (m[1] === 'the main process running') phases.length = 0;
    phases.push({ what: m[1] ?? '', ms: Number(m[2]) });
  }
  return phases;
}

/** The figure, once the last start's output has painted the show put back: its ms and a line saying it. */
export function recoveryFigure(userData: string): { ms: number; line: string } | null {
  const phases = lastStartPhases(userData);
  const ready = phases.find((p) => p.what.startsWith('engine ready') && p.what.endsWith('the show put back'));
  const back = phases.find((p) => /^(output ".+"|an output) first painted revision \d+$/u.test(p.what));
  if (!ready || !back) return null;
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  return {
    ms: back.ms,
    line: `recovery: ${s(back.ms)} from the start to the screens back (${phases.map((p) => `${p.what} ${s(p.ms)}`).join('; ')})`,
  };
}

/**
 * The recovery figure's budget on each system (Sessions 31–36, PERF-1): the 90th percentile of 10 runs on CI's
 * machines, plus 25% (runs 39038852887 and 39038858168, 17 October 2026). The Mac's ten: 3.4 to 9.0 s, p90 5.6
 * s; Windows': 3.3 to 5.0 s, p90 4.1 s. Most of it is the output's first frame after its GPU's warm-up.
 */
export const RECOVERY_BUDGET_MS: Readonly<Record<string, number>> = { darwin: 7000, win32: 5100 };

/** This system's budget (any other: the larger). */
export const recoveryBudget = (): number =>
  RECOVERY_BUDGET_MS[process.platform] ?? Math.max(...Object.values(RECOVERY_BUDGET_MS));

/**
 * The figure against the budget: one over it is measured again, and it fails only when over twice in a row
 * (the virtual machines swing). Each figure's line is said as it comes. The Performance check holds it to the
 * budget (where timing is judged); the end-to-end test only says it, as the whole suite slows CI's machines.
 */
export async function recoveryAgainstBudget(say: (line: string) => void): Promise<void> {
  const budget = recoveryBudget();
  const first = await crashAndRecover();
  say(first.line);
  expect(first.ms).toBeGreaterThan(0);
  if (first.ms <= budget) return;
  say(`over the budget of ${(budget / 1000).toFixed(1)} s once: measured again`);
  const second = await crashAndRecover();
  say(second.line);
  expect(
    second.ms,
    `over the budget of ${String(budget)} ms twice in a row: ${String(first.ms)} and ${String(second.ms)} ms`,
  ).toBeLessThanOrEqual(budget);
}

/** A slide live on one output, Drashti stopped dead, started again: the figure, once the screen is back. */
export async function crashAndRecover(): Promise<{ ms: number; line: string }> {
  const first = await launchApp();
  const win = await operatorPage(first.app);
  const id = await makeSlides(win, 'Placeholder recovery figure', [{ words: 'Placeholder figure one' }], {
    kind: 'cut',
    durationMs: 0,
  });
  await setUpScreen(win);
  await outputPage(first.app);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    id,
  );
  await savedLive(first.userData, (saved) => saved.slide?.slideIndex === 0);
  await killApp(first.app);
  // Started again: the show back on the screen, and the start's phase lines in the log say when. The waits
  // are long whatever the config's (the Performance check's is Playwright's 5 s): the figure is what is
  // judged, against its budget, and CI's Mac took 9.0 s once (run 39038852887).
  const second = await relaunchApp(first.userData);
  try {
    const output = await outputPage(second.app);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder figure one', {
      timeout: 30_000,
    });
    // The output says its first frame within its next report (every 2 s).
    await expect.poll(() => recoveryFigure(first.userData)?.ms ?? null, { timeout: 15_000 }).not.toBeNull();
    const figure = recoveryFigure(first.userData);
    if (!figure) throw new Error('no recovery figure');
    return figure;
  } finally {
    await second.app.close();
  }
}
