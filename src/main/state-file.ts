import { existsSync, readFileSync, renameSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileStamp } from '../shared/format';

/*
 * Small state files (Session 23: Main's node identity, the role file, a
 * node's pairing): "cannot be read" is not "missing". Before, every one of
 * them treated a file it could not read as no file at all, and made a new one
 * over it: a damaged identity silently cut off every paired node.
 *
 * - missing: there is none (make a new one, as before);
 * - unreadable: it is there but cannot be read (locked by antivirus for a
 *   moment, a folder in its place, no permission);
 * - invalid: it was read, but is not what Drashti wrote (cut short, damaged).
 *
 * An unreadable or invalid file is read once more after a short wait, and if
 * it still fails, it is never written over: it is moved aside with the date
 * (setAside), the log says so, and the operator is told.
 */

export type StateRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string }
  | { status: 'invalid'; reason: string };

/** Read and check a JSON state file once. `parse` answers the value, or null when it is not one. */
export function readState<T>(file: string, parse: (raw: unknown) => T | null): StateRead<T> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'missing' };
    return { status: 'unreadable', reason: code ?? String(error) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'invalid', reason: 'not readable as JSON (cut short or damaged)' };
  }
  const value = parse(raw);
  return value === null
    ? { status: 'invalid', reason: 'not in the form Drashti writes' }
    : { status: 'ok', value };
}

const pause = (ms: number) => {
  // Synchronous on purpose, and only when a file failed to read: these files are read at the start.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Read it, and if it is there but fails, once more after `retryMs` (a file locked for a moment). */
export function readStateTwice<T>(
  file: string,
  parse: (raw: unknown) => T | null,
  retryMs = 250,
): StateRead<T> {
  const first = readState(file, parse);
  if (first.status === 'ok' || first.status === 'missing') return first;
  pause(retryMs);
  return readState(file, parse);
}

/**
 * Move a file (or a folder in its place) aside, keeping it: `identity.json` becomes
 * `identity.unreadable-2026-10-10 05-36.json` beside it (with " 2", " 3"… if that name is
 * taken: nothing set aside before is written over). The new path, or null when it could not
 * be moved (then it stays where it is, still never written over).
 */
export function setAside(file: string, now = new Date()): string | null {
  const ext = extname(file);
  const name = `${basename(file, ext)}.unreadable-${fileStamp(now)}`;
  let to = join(dirname(file), `${name}${ext}`);
  for (let n = 2; existsSync(to); n++) to = join(dirname(file), `${name} ${n}${ext}`);
  try {
    renameSync(file, to);
    return to;
  } catch {
    return null;
  }
}
