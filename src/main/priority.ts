import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { constants, getPriority, setPriority } from 'node:os';
import { join } from 'node:path';

/*
 * How high Drashti's main process runs on Windows. Session 15 raised it above
 * normal: on two cores with no graphics chip, the windows decoding video at
 * the same priority kept the main process (every slide change) waiting for up
 * to 2 s at a time. But with a new dissolving video every two seconds the
 * screens then kept fewer frames, so it is a trade-off that only the mandir's
 * own PC can settle. Session 16 lets an admin set it back to normal there,
 * without a new build: File > Run Ahead of Other Programs (on a node too).
 * It belongs to the computer, not the library (a library restored elsewhere
 * does not bring it), so it is kept in the data folder beside the role.
 * DRASHTI_PRIORITY (normal or above-normal) overrides it for one run, as the
 * performance check does to compare the two.
 */

export type MainPriority = 'above-normal' | 'normal';

const FILE = 'drashti-priority.json';

/** Above normal unless an admin set it back, or the environment says otherwise for this run. */
export function readPriority(userData: string, env: string | undefined): MainPriority {
  if (env === 'normal' || env === 'above-normal') return env;
  try {
    const raw = JSON.parse(readFileSync(join(userData, FILE), 'utf8')) as { priority?: unknown };
    return raw.priority === 'normal' ? 'normal' : 'above-normal';
  } catch {
    return 'above-normal';
  }
}

export function writePriority(userData: string, priority: MainPriority): void {
  const file = join(userData, FILE);
  writeFileSync(`${file}.writing`, JSON.stringify({ priority }, null, 2));
  renameSync(`${file}.writing`, file);
}

/** Set this process's priority (Windows only; macOS lets only the administrator raise it). */
export function applyPriority(
  priority: MainPriority,
  platform: NodeJS.Platform = process.platform,
  set: (value: number) => void = (value) => {
    setPriority(value);
  },
): boolean {
  if (platform !== 'win32') return false;
  try {
    set(
      priority === 'normal' ? constants.priority.PRIORITY_NORMAL : constants.priority.PRIORITY_ABOVE_NORMAL,
    );
    return true;
  } catch {
    // Not allowed: it stays as it was.
    return false;
  }
}

/** This process's priority in words, for the log and the performance check. */
export function describePriority(): string {
  let value: number;
  try {
    value = getPriority();
  } catch {
    return 'unknown';
  }
  const p = constants.priority;
  if (value === p.PRIORITY_NORMAL) return 'normal';
  if (value === p.PRIORITY_ABOVE_NORMAL) return 'above normal';
  if (value === p.PRIORITY_HIGH || value === p.PRIORITY_HIGHEST) return 'high';
  if (value === p.PRIORITY_BELOW_NORMAL) return 'below normal';
  if (value === p.PRIORITY_LOW) return 'low';
  return `nice ${String(value)}`;
}
