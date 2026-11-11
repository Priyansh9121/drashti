import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/*
 * What a deck's import leaves behind when Drashti stops in the middle of it (Session 54, C review): the copies it
 * opened in PowerPoint's own folder (Office's Drashti/convert-*), and its work folders (drashti-pictures-*, the
 * timed copy, the movie and its cut steps), cleared at Drashti's next start, before any import runs.
 *
 * PowerPoint's folder is another app's (Session 56): each time Drashti reads it, macOS asks the operator whether it
 * may ("Keeping app data separate makes it easier to manage your privacy and security"), and the start read it every
 * time. So Drashti keeps its own record of the copies it puts there, in its own data folder: each written down
 * before its folder is made, and forgotten once the import has removed it. A start touches PowerPoint's folder only
 * when that record names copies (Drashti stopped in the middle of a PowerPoint import), and then only those, by
 * name, never listing the folder; they go, and the record with them. The temporary folder's work folders are
 * Drashti's own, cleared at every start as before. Windows has no such folder: PowerPoint there works in Drashti's.
 */

/** PowerPoint for Mac's own folder, where Drashti puts the copies it opens there. */
export const OFFICE_DRASHTI = join(homedir(), 'Library', 'Group Containers', 'UBF8T346G9.Office', 'Drashti');

/** Drashti's record of the copies it put in PowerPoint's folder, in a data folder. */
export const officeCopiesFile = (userData: string) => join(userData, 'office-copies.json');

const recordSchema = z.object({
  version: z.literal(1),
  copies: z.array(z.string().min(1).max(4096)).max(1000),
});

/** Drashti's own record of the copies it put in PowerPoint's folder, kept in its own data folder. */
export class OfficeCopies {
  constructor(private readonly file: string) {}

  /** The copies written down: none when there is no record, or it cannot be read. */
  list(): string[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = recordSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data.copies : [];
    } catch {
      return [];
    }
  }

  /** A copy's folder, written down before anything goes there. Throws when the record cannot be written. */
  add(folder: string): void {
    this.write([...this.list().filter((f) => f !== folder), folder]);
  }

  /** A copy's folder that has gone: forgotten, and the record with the last of them. */
  forget(folder: string): void {
    const copies = this.list();
    if (copies.includes(folder)) this.write(copies.filter((f) => f !== folder));
  }

  private write(copies: string[]): void {
    if (copies.length === 0) {
      rmSync(this.file, { force: true });
      return;
    }
    // Written whole, then put in its place, by whichever process writes it (an import's, or Drashti's at start).
    const tmp = `${this.file}.${String(process.pid)}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ version: 1, copies }), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }
}

/** Forget a copy's folder; a record that cannot be written now only means a start finds the folder gone. */
function forgetQuietly(copies: OfficeCopies | null, folder: string): void {
  try {
    copies?.forget(folder);
  } catch {
    // Still written down: the next start finds it gone, which is no trouble.
  }
}

/**
 * A folder of its own for a copy in `folder` (PowerPoint's, or Keynote's work folder): `convert-` and twelve letters,
 * written down in `copies` (PowerPoint's) before it is made. Throws when the record cannot be written, so a copy
 * never goes where a start after a stop would not find it.
 */
export async function officeCopyFolder(copies: OfficeCopies | null, folder: string): Promise<string> {
  for (let tries = 1; ; tries++) {
    const inside = join(folder, `convert-${randomBytes(6).toString('hex')}`);
    copies?.add(inside);
    try {
      await mkdir(folder, { recursive: true });
      await mkdir(inside);
      return inside;
    } catch (error) {
      // Not made: not Drashti's (another's of that name), or nothing at all.
      forgetQuietly(copies, inside);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || tries === 5) throw error;
    }
  }
}

/** Remove a copy's folder and, once it has gone, forget it; whether it went (one still held stays written down). */
export async function dropOfficeCopy(copies: OfficeCopies | null, inside: string): Promise<boolean> {
  try {
    await rm(inside, { recursive: true, force: true });
  } catch {
    return false;
  }
  forgetQuietly(copies, inside);
  return true;
}

export interface LeftoverPlaces {
  /** Drashti's record of the copies it put in PowerPoint's folder. */
  copies?: OfficeCopies | null;
  /** PowerPoint's folder (tests give one of their own). */
  office?: string;
  /** The temporary folder (tests give one of their own). */
  temp?: string;
  /** Told of each thing done in PowerPoint's folder, before it is done (tests count them). */
  touched?: (path: string) => void;
}

/**
 * Clear them; returns how many folders went. PowerPoint's folder only for the copies the record names, read as this
 * begins (before its first wait, so before any import could write down a copy of its own). Folders that are not
 * there are no trouble.
 */
export async function clearDeckLeftovers(where: LeftoverPlaces = {}): Promise<number> {
  const copies = where.copies ?? null;
  const named = copies?.list() ?? [];
  const office = resolve(where.office ?? OFFICE_DRASHTI);
  let cleared = 0;
  for (const folder of named) {
    const place = resolve(folder);
    // Only a copy's folder right inside PowerPoint's: anything else in the record is forgotten, never touched.
    if (dirname(place) !== office || !basename(place).startsWith('convert-')) {
      forgetQuietly(copies, folder);
      continue;
    }
    where.touched?.(place);
    if (await dropOfficeCopy(copies, folder)) cleared++;
  }
  const temp = where.temp ?? tmpdir();
  let names: string[];
  try {
    names = await readdir(temp);
  } catch {
    return cleared;
  }
  for (const name of names.filter((n) => n.startsWith('drashti-pictures-'))) {
    await rm(join(temp, name), { recursive: true, force: true }).catch(() => undefined);
    cleared++;
  }
  return cleared;
}
