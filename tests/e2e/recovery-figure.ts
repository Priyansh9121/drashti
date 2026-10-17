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
  // Started again: the show back on the screen, and the start's phase lines in the log say when.
  const second = await relaunchApp(first.userData);
  try {
    const output = await outputPage(second.app);
    await expect(output.locator('[data-layer="slide"]')).toContainText('Placeholder figure one');
    // The output says its first frame within its next report (every 2 s).
    await expect.poll(() => recoveryFigure(first.userData)?.ms ?? null, { timeout: 15_000 }).not.toBeNull();
    const figure = recoveryFigure(first.userData);
    if (!figure) throw new Error('no recovery figure');
    return figure;
  } finally {
    await second.app.close();
  }
}
