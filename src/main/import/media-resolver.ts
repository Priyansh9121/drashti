import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Finding the media file a presentation names (PLAN.md 4.4). In order:
 *   1. its original path, if that file still exists here;
 *   2. a file with the same name next to the imported file, or in a
 *      bundle's or collected folder's media (the `nearby` folders);
 *   3. a file with the same name anywhere under the folders being imported.
 * Anything still missing is kept as a missing media item for the operator
 * to relink from a folder they pick (relinkFromFolder uses the same rules).
 */

export interface MediaLookup {
  /** Folders to try for a file of the same name, nearest first. */
  nearby: readonly string[];
  /** Lower-case file name -> paths, from scanning the imported folders. */
  byName: ReadonlyMap<string, readonly string[]>;
  isFile?: (path: string) => boolean;
}

export interface Resolved {
  path: string;
  how: 'original' | 'nearby' | 'found';
  /** Other files with the same name that were not picked. */
  alternatives: number;
}

const defaultIsFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * The local path a reference names: file URLs and percent-encoded paths
 * (as playlists store them) are decoded, and ~ means this computer's home
 * folder. Windows paths stay as they are (they only exist on Windows).
 */
export function pathFromReference(reference: string): string {
  const ref = reference.trim();
  if (/^file:/iu.test(ref)) {
    try {
      return fileURLToPath(ref);
    } catch {
      // A Windows file URL on macOS (file:///C:/...): keep its path part.
      return safeDecode(ref.replace(/^file:\/*/iu, ''));
    }
  }
  const decoded = /%[0-9A-Fa-f]{2}/u.test(ref) ? safeDecode(ref) : ref;
  return decoded.startsWith('~/') ? join(homedir(), decoded.slice(2)) : decoded;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The file name at the end of a path, whichever separator it uses. */
export function fileNameOf(reference: string): string {
  const path = pathFromReference(reference);
  return path.split(/[\\/]/u).pop() ?? path;
}

/** The folder name just above the file, to break ties between files with the same name. */
function parentNameOf(path: string): string {
  const parts = path.split(/[\\/]/u);
  return (parts[parts.length - 2] ?? '').toLowerCase();
}

export function resolveMedia(reference: string, lookup: MediaLookup): Resolved | null {
  const isFile = lookup.isFile ?? defaultIsFile;
  const original = pathFromReference(reference);
  if (original !== '' && isFile(original)) return { path: original, how: 'original', alternatives: 0 };
  const name = fileNameOf(reference);
  if (name === '') return null;
  for (const dir of lookup.nearby) {
    const candidate = join(dir, name);
    if (isFile(candidate)) return { path: candidate, how: 'nearby', alternatives: 0 };
  }
  const found = lookup.byName.get(name.toLowerCase()) ?? [];
  if (found.length === 0) return null;
  const parent = parentNameOf(original);
  const best = found.find((p) => parentNameOf(p) === parent) ?? found[0];
  return best ? { path: best, how: 'found', alternatives: found.length - 1 } : null;
}
