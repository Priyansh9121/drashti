import { mkdir, mkdtemp, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { entryPath, withZip, writeEntry, type ZipEntry } from '../import/zip';
import { formatBytes } from '../../shared/format';
import { claimFolder, safeName } from './names';

/*
 * Unpacking a Dropbox folder (Session 25b): Dropbox sends a shared folder as
 * one zip. It is unpacked into a new folder of its own beside where it was
 * saved, and only if all of it is safe:
 *
 * - no entry may name a path outside that folder (../, /, C:) and none may be
 *   a symbolic link: if one does, nothing at all is unpacked. An empty entry
 *   that names only the folder itself ("/", "./" or nothing) is skipped:
 *   Dropbox's folder zips start with a directory named "/" (Session 26a);
 * - at most so many files and so many bytes, and never so many that less than
 *   the space Drashti keeps free would be left;
 * - names are made safe for both systems, and nothing gets execute bits:
 *   nothing unpacked is ever run.
 *
 * It unpacks into a hidden work folder first and takes its real name only
 * when every file is out, so a stopped or failed unpack leaves nothing under
 * a real name.
 */

export interface UnpackLimits {
  maxFiles: number;
  maxBytes: number;
  freeBytes(dir: string): number;
  /** Bytes that must stay free on the disk afterwards. */
  keepFree: number;
  /** Told the work folder's path before anything is written (to clear it after a crash). */
  onWorkFolder?(path: string): void;
  signal?: AbortSignal;
  /** True while unpacking must wait (the stream on air or recording): it waits between files. */
  held?(): boolean;
}

/**
 * Which rule stopped an unpack, as a short code for the log (never a name from the zip): a path
 * leaving the folder, a link, too many files, too many bytes, too little space left, a packing
 * Drashti cannot read, a damaged zip, a file that could not be written, or stopped.
 */
export type UnzipRule =
  'leave' | 'link' | 'count' | 'size' | 'space' | 'method' | 'damaged' | 'write' | 'stopped';

export type UnpackResult =
  | { ok: true; folder: string; files: string[]; bytes: number }
  | { ok: false; message: string; rule: UnzipRule };

interface Refusal {
  message: string;
  rule: UnzipRule;
}

/** OS clutter in a zip: never content. */
const clutter = (name: string) => name.startsWith('__MACOSX/') || name.split('/').pop() === '.DS_Store';

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** A name that is only the folder itself: "/", "./", "." or nothing (any slashes either way). */
const namesRoot = (name: string) =>
  name
    .replace(/\\/gu, '/')
    .split('/')
    .every((part) => part === '' || part === '.');

/**
 * An entry to skip: empty, and naming only the folder itself. Dropbox's folder zips list a spurious
 * directory "/" (usethis.r-lib.org/reference/use_course_details.html, read 14 Oct 2026); `entryPath`
 * rightly refuses a name starting with "/", which refused every Dropbox folder (PLAN §6).
 */
const onlyTheFolder = (e: ZipEntry) => e.size === 0 && namesRoot(e.name);

const isLink = (e: ZipEntry) => e.unixMode !== null && (e.unixMode & S_IFMT) === S_IFLNK;

/** Why this zip may not be unpacked at all, or null. */
function refusal(entries: ZipEntry[], limits: UnpackLimits, parent: string): Refusal | null {
  for (const e of entries) {
    // A link is refused whatever it is called.
    if (isLink(e))
      return {
        rule: 'link',
        message:
          'The folder’s zip holds a link to somewhere else on the computer, so nothing in it was unpacked.',
      };
    if (onlyTheFolder(e)) continue;
    // Anything else naming the folder itself (a file called "/") has nowhere to go inside it.
    if (entryPath(parent, e.name) === null || (!e.isDirectory && namesRoot(e.name)))
      return {
        rule: 'leave',
        message:
          'The folder’s zip has a file whose path would leave the folder, so nothing in it was unpacked.',
      };
  }
  const files = filesIn(entries);
  if (files.length > limits.maxFiles)
    return {
      rule: 'count',
      message: `The folder holds more than ${String(limits.maxFiles)} files, too many to unpack at once.`,
    };
  const bytes = files.reduce((sum, e) => sum + e.size, 0);
  if (bytes > limits.maxBytes)
    return {
      rule: 'size',
      message: `The folder is too big to unpack (${formatBytes(bytes)}; at most ${formatBytes(limits.maxBytes)}).`,
    };
  const free = limits.freeBytes(parent);
  if (free - bytes < limits.keepFree)
    return {
      rule: 'space',
      message: `Unpacking the folder (${formatBytes(bytes)}) would leave less than ${formatBytes(limits.keepFree)} free on the disk, which Drashti keeps free for the show. Free up some space, then try again.`,
    };
  const odd = files.find((e) => e.method !== 0 && e.method !== 8);
  if (odd) return { rule: 'method', message: 'The folder’s zip is packed in a way Drashti cannot unpack.' };
  return null;
}

/** The files to unpack: no folders, no OS clutter, and not the folder itself. */
const filesIn = (entries: ZipEntry[]) =>
  entries.filter((e) => !e.isDirectory && !clutter(e.name) && !onlyTheFolder(e));

/** A damaged zip's errors: the zip reader's own, or zlib's (a deflated entry that does not inflate). */
const damaged = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'ZipError' || ((error as NodeJS.ErrnoException).code ?? '').startsWith('Z_'));

/** Safe, distinct paths inside the folder for each file (both systems, case-blind). */
function placeFiles(files: ZipEntry[]): Map<ZipEntry, string[]> {
  const taken = new Set<string>();
  const out = new Map<ZipEntry, string[]>();
  const key = (parts: string[]) => parts.join('/').toLowerCase();
  for (const e of files) {
    const parts = e.name
      .replace(/\\/gu, '/')
      .split('/')
      .filter((p) => p !== '' && p !== '.')
      .map((p) => safeName(p, '_'));
    const leaf = parts.pop() ?? '_';
    let name = leaf;
    for (let n = 2; taken.has(key([...parts, name])); n++) {
      const dot = leaf.lastIndexOf('.');
      name = dot > 0 ? `${leaf.slice(0, dot)} (${String(n)})${leaf.slice(dot)}` : `${leaf} (${String(n)})`;
    }
    taken.add(key([...parts, name]));
    out.set(e, [...parts, name]);
  }
  return out;
}

/** Unpack a folder's zip into a new folder named `name` (or "name (2)") in `parent`. */
export async function unpackFolderZip(
  zip: string,
  parent: string,
  name: string,
  limits: UnpackLimits,
): Promise<UnpackResult> {
  // Set inside the zip's callback: the work folder to remove if anything stops before it is named.
  const pending: { work: string | null } = { work: null };
  try {
    return await withZip(zip, async (entries, fh) => {
      const refused = refusal(entries, limits, parent);
      if (refused) return { ok: false as const, ...refused };
      const files = filesIn(entries);
      const places = placeFiles(files);
      const work = await mkdtemp(join(parent, '.drashti-unpacking-'));
      pending.work = work;
      limits.onWorkFolder?.(work);
      let bytes = 0;
      const written: string[][] = [];
      for (const e of files) {
        while (limits.held?.() && !limits.signal?.aborted) await new Promise((r) => setTimeout(r, 500));
        if (limits.signal?.aborted) throw new Error('stopped');
        const parts = places.get(e) ?? [];
        const target = join(work, ...parts);
        await mkdir(dirname(target), { recursive: true });
        await writeEntry(fh, e, target, { exclusive: true });
        bytes += e.size;
        written.push(parts);
      }
      const folder = await takeName(work, parent, safeName(name, 'Dropbox folder'));
      pending.work = null;
      return { ok: true as const, folder, files: written.map((parts) => join(folder, ...parts)), bytes };
    });
  } catch (error) {
    const stopped = limits.signal?.aborted === true;
    const broken = !stopped && damaged(error);
    return {
      ok: false,
      rule: stopped ? 'stopped' : broken ? 'damaged' : 'write',
      message: stopped
        ? 'Stopped while unpacking. Nothing was kept.'
        : `The folder’s zip could not be unpacked${broken ? ' (it is damaged)' : ''}. Nothing was kept.`,
    };
  } finally {
    if (pending.work !== null)
      await rm(pending.work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Give the finished work folder its real name: the name, or the first free "name (n)". */
async function takeName(work: string, parent: string, name: string): Promise<string> {
  for (let tries = 0; tries < 20; tries++) {
    const target = await claimFolder(parent, name);
    // Claimed (empty): put the work folder in its place. Someone may take the name in between: try again.
    await rmdir(target);
    try {
      await rename(work, target);
      return target;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'EPERM') throw error;
    }
  }
  throw new Error('No free name for the folder');
}
