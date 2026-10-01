// One temporary folder per test run. Unit and end-to-end runs point TMPDIR (TEMP and TMP on
// Windows) into it, so the temporary folders their tests make, and the data folders of the
// apps they start, all go when the run ends. Roots left by a run that crashed are cleared at
// the next start, with any loose drashti-* folders over an hour old from before this existed.
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'drashti-run-';
const HOUR = 3_600_000;

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, and belongs to someone else.
    return error?.code === 'EPERM';
  }
}

function remove(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return true;
  } catch (error) {
    process.stderr.write(
      `Could not remove ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return false;
  }
}

/** Remove the roots of runs that are no longer going, and old loose drashti-* folders. Returns how many went. */
export function clearStaleTempRoots(base = tmpdir(), now = Date.now()) {
  let removed = 0;
  let names;
  try {
    names = readdirSync(base);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith('drashti-')) continue;
    const path = join(base, name);
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (!info.isDirectory()) continue;
    const age = now - info.mtimeMs;
    const stale = name.startsWith(PREFIX)
      ? !alive(Number(name.slice(PREFIX.length).split('-')[0])) || age > 12 * HOUR
      : age > HOUR;
    if (stale && remove(path)) removed++;
  }
  return removed;
}

/** A fresh root for this run (named by this process's id), after clearing stale ones. */
export function makeTempRoot(base = tmpdir()) {
  const cleared = clearStaleTempRoots(base);
  if (cleared > 0)
    process.stderr.write(`Cleared ${cleared} temporary folder(s) left by earlier test runs.\n`);
  const dir = join(base, `${PREFIX}${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir);
  return dir;
}

/** The environment that sends os.tmpdir() into the root, on every OS. */
export function tempEnv(dir) {
  return { TMPDIR: dir, TEMP: dir, TMP: dir };
}

export function removeTempRoot(dir) {
  remove(dir);
}
