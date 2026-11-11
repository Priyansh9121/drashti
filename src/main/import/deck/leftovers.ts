import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/*
 * What a deck's import leaves behind when Drashti stops in the middle of it (Session 54, C review): the copies it
 * opened in PowerPoint's own folder (Office's Drashti/convert-*), and its work folders (drashti-pictures-*, the
 * timed copy, the movie and its cut steps), cleared at Drashti's next start, before any import runs.
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
    writeFileSync(tmp, JSON.stringify({ version: 1, copies }), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/** A folder of its own for a copy in `folder` (PowerPoint's, or Keynote's work folder). */
export async function officeCopyFolder(_copies: OfficeCopies | null, folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  return mkdtemp(join(folder, 'convert-'));
}

/** Remove a copy's folder; whether it went. */
export async function dropOfficeCopy(_copies: OfficeCopies | null, inside: string): Promise<boolean> {
  try {
    await rm(inside, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
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

/** Clear them; returns how many folders went. Folders that are not there are no trouble. */
export async function clearDeckLeftovers(where: LeftoverPlaces = {}): Promise<number> {
  let cleared = 0;
  const clear = async (folder: string, prefix: string, touched?: (path: string) => void) => {
    let names: string[];
    try {
      touched?.(folder);
      names = await readdir(folder);
    } catch {
      return;
    }
    for (const name of names.filter((n) => n.startsWith(prefix))) {
      touched?.(join(folder, name));
      await rm(join(folder, name), { recursive: true, force: true }).catch(() => undefined);
      cleared++;
    }
  };
  await clear(where.office ?? OFFICE_DRASHTI, 'convert-', where.touched);
  await clear(where.temp ?? tmpdir(), 'drashti-pictures-');
  return cleared;
}
