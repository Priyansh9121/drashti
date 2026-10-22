import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { plural } from '../shared/text';
import type { RestoreOutcome } from './library/backup';
import type { SelfTestCheck, SelfTestResult } from './selftest';

/*
 * DRASHTI_SELFTEST=restore-relaunch: the restart after Restore Library…, for
 * real. Playwright cannot follow app.relaunch() (the new copy waits for it
 * forever), so scripts/check-relaunch.mjs starts Drashti with this switch and
 * waits for the result file in DRASHTI_SELFTEST_DIR:
 *
 *  1. The first start backs the library up (into that folder), changes the
 *     library, asks for a restore of the backup and restarts the way Restore
 *     Library… does: app.relaunch(), then a clean quit. A new library has no
 *     presentations (Session 50: no placeholder ones, and the check starts
 *     Drashti, built or packaged, in a new data folder), so one goes in before
 *     the backup: the restore must bring the backup's presentations back, not
 *     only undo the change made after it.
 *  2. The copy that starts again finds the restore done at its start, checks
 *     the library is the backup's, writes result.json and quits.
 *
 * A note in the data folder says which of the two this start is, so a restore
 * that fails can never restart again and again.
 */

export const RELAUNCH_MARK = 'relaunch-selftest.json';
export const RELAUNCH_RESULT = 'result.json';
/** In a new library, before the backup: the restore must bring it back. */
const KEPT = 'Placeholder kept in the backup';
/** After the backup: the restore must undo it. */
const ADDED = 'Placeholder added after the backup';

const markSchema = z.object({ pid: z.number(), expect: z.array(z.string()) });

export interface RelaunchSelfTestContext {
  userData: string;
  /** Holds the backup and the result; outside the data folder. */
  workDir: string;
  /** What this start's restore did (applyPendingRestore). */
  restored: RestoreOutcome;
  /** The library's presentation names. */
  names: () => string[];
  /** Back the library up into a new folder in `into`; returns that folder. */
  backUp: (into: string) => Promise<string>;
  /** Add a placeholder presentation of this name: one for the backup to hold, and the change for the restore to undo. */
  add: (name: string) => void;
  /** Ask for a restore from a backup folder at the next start. */
  requestRestore: (from: string) => void;
  /** Restart as Restore Library… does. */
  restart: () => void;
  /** End this start (a clean quit). */
  exit: (code: number) => void;
}

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((name, i) => name === [...b].sort()[i]);

export async function runRelaunchSelfTest(ctx: RelaunchSelfTestContext): Promise<void> {
  const markFile = join(ctx.userData, RELAUNCH_MARK);
  if (!existsSync(markFile)) {
    // 1. The first start: in a new library, a presentation for the backup to hold first.
    if (ctx.names().length === 0) ctx.add(KEPT);
    const expect = ctx.names();
    const folder = await ctx.backUp(ctx.workDir);
    ctx.add(ADDED);
    writeFileSync(markFile, JSON.stringify({ pid: process.pid, expect }));
    ctx.requestRestore(folder);
    ctx.restart();
    return;
  }
  // 2. The start after the restart.
  const checks: SelfTestCheck[] = [];
  const mark = markSchema.safeParse(JSON.parse(readFileSync(markFile, 'utf8')));
  rmSync(markFile, { force: true });
  const names = ctx.names();
  checks.push({
    name: 'Drashti started again by itself, as a new process',
    ok: mark.success && mark.data.pid !== process.pid,
    detail: mark.success
      ? `first ${mark.data.pid}, now ${process.pid}`
      : 'the note from the first start is unreadable',
  });
  checks.push({
    name: 'the restore was done at the start',
    ok: ctx.restored.restored,
    detail: ctx.restored.restored
      ? `kept the old library in Backups/${ctx.restored.keptIn}`
      : (ctx.restored.message ?? 'nothing was asked'),
  });
  checks.push({
    name: 'the library is the backup’s',
    ok: mark.success && sameNames(names, mark.data.expect),
    detail: plural(names.length, 'presentation'),
  });
  const result: SelfTestResult = { passed: checks.every((c) => c.ok), checks };
  writeFileSync(join(ctx.workDir, RELAUNCH_RESULT), JSON.stringify(result));
  ctx.exit(result.passed ? 0 : 1);
}
