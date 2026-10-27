import { stat } from 'node:fs/promises';
import { run, sleep } from '../deck-converters';

/*
 * A deck's movie that makes no progress for a minute is given up on (Session 54, C review): its app is asking a
 * question nobody sees, or is stuck. Progress is the movie growing, or the app at work: its processor time going up
 * by half a second or more (an app making a movie uses seconds of it each minute; one waiting on a question next to
 * none). Keynote's movie is watched so (its export answers only once the movie is made); PowerPoint for Mac's by its
 * file alone (`settledMovie`, in ./bake.ts), and Windows' in its own script (POWERPOINT_WINDOWS_BAKE_SCRIPT).
 */

/** No progress for this long: given up on. */
export const NO_PROGRESS_MS = 60_000;
/** Processor time that counts as the app at work. */
export const WORKING_CPU_MS = 500;

export interface Progress {
  /** The app's processor time so far, in ms (null: not known). */
  cpuMs: number | null;
  /** The movie's size so far (null: not there yet). */
  bytes: number | null;
}

/**
 * Resolves 'stalled' once `read` has shown no progress for `stallMs`: the movie the same size, and the app's
 * processor time up by less than `workingMs` since the last progress. 'stopped' when `signal` aborts first.
 */
export async function noProgress(
  read: () => Promise<Progress>,
  options: { signal: AbortSignal; stallMs?: number; everyMs?: number; workingMs?: number },
): Promise<'stalled' | 'stopped'> {
  const { signal } = options;
  /** Asked afresh each time: the signal may abort while it waits. */
  const stopped = () => signal.aborted;
  const stallMs = options.stallMs ?? NO_PROGRESS_MS;
  const workingMs = options.workingMs ?? WORKING_CPU_MS;
  let mark = await read();
  let since = Date.now();
  while (!stopped()) {
    await sleep(options.everyMs ?? 2000, signal);
    if (stopped()) break;
    const now = await read();
    const grew = now.bytes !== mark.bytes;
    const worked = now.cpuMs !== null && mark.cpuMs !== null && now.cpuMs - mark.cpuMs >= workingMs;
    if (grew || worked || (mark.cpuMs === null && now.cpuMs !== null)) {
      mark = now;
      since = Date.now();
    } else if (Date.now() - since >= stallMs) return 'stalled';
  }
  return 'stopped';
}

/** `ps -o time=`'s processor time ("12:34.56", "1-02:03:04.5", one a line), in ms, all of them together. */
export function cpuTimeMs(text: string): number | null {
  let total = 0;
  let any = false;
  for (const line of text.split('\n')) {
    const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/u.exec(line);
    if (!m) continue;
    const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = m;
    total += ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000;
    any = true;
  }
  return any ? Math.round(total) : null;
}

/** How a movie being made by an app on a Mac is getting on: the app's processor time and the movie's size. */
export async function macProgress(pids: number[], movie: string): Promise<Progress> {
  const cpu =
    pids.length === 0
      ? null
      : cpuTimeMs(
          (
            await run('ps', ['-o', 'time=', '-p', pids.join(',')], 5000, undefined, {
              ...process.env,
              LC_ALL: 'C',
              LANG: 'C',
            })
          ).stdout,
        );
  const bytes = await stat(movie).then(
    (s) => s.size,
    () => null,
  );
  return { cpuMs: cpu, bytes };
}
