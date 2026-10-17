import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
